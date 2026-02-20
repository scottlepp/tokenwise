import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { BaseProvider } from "./base";
import type { ProviderModel, ProviderRequest, ProviderResponse, ProviderStreamResponse } from "./base";
import { convertMessages } from "../message-converter";
import { createClaudeNdjsonTransformer } from "../stream-transformers/claude-ndjson";
import { parseToolCalls } from "../tool-parser";

const LONG_PROMPT_THRESHOLD = 100_000; // bytes

let claudeExists: boolean | null = null;

function checkClaudeExists(): boolean {
  if (claudeExists !== null) return claudeExists;
  try {
    const { execSync } = require("child_process");
    execSync("which claude", { stdio: "ignore" });
    claudeExists = true;
  } catch {
    claudeExists = false;
  }
  return claudeExists;
}

function extractModelUsage(resultEvent: Record<string, unknown>): {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
} {
  const modelUsage = resultEvent.modelUsage as Record<string, Record<string, number>> | undefined;
  if (modelUsage) {
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    for (const model of Object.values(modelUsage)) {
      tokensIn += (model.inputTokens ?? 0) + (model.cacheReadInputTokens ?? 0) + (model.cacheCreationInputTokens ?? 0);
      tokensOut += model.outputTokens ?? 0;
      costUsd += model.costUSD ?? 0;
    }
    return { tokensIn, tokensOut, costUsd };
  }

  const usage = resultEvent.usage as Record<string, number> | undefined;
  const totalCost = resultEvent.total_cost_usd as number | undefined;
  return {
    tokensIn: (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0),
    tokensOut: usage?.output_tokens ?? 0,
    costUsd: totalCost ?? 0,
  };
}

function buildArgs(model: string, prompt: string, systemPrompt: string | null, streaming: boolean): string[] {
  const args = [
    "-p",
    ...(prompt.length <= LONG_PROMPT_THRESHOLD ? [prompt] : ["-"]),
    "--output-format",
    streaming ? "stream-json" : "json",
    "--model",
    model,
    "--verbose",
    "--no-session-persistence",
  ];

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  return args;
}

export class ClaudeCliProvider extends BaseProvider {
  readonly id = "claude-cli" as const;
  readonly displayName = "Claude (CLI)";
  private models: ProviderModel[];

  constructor(models?: ProviderModel[]) {
    super();
    this.models = models ?? [];
  }

  isAvailable(): boolean {
    return checkClaudeExists();
  }

  getModels(): ProviderModel[] {
    return this.models;
  }

  async complete(params: ProviderRequest): Promise<ProviderResponse> {
    const { systemPrompt, prompt, hasTools } = convertMessages(params.messages, params.tools);
    const effectiveSystemPrompt = params.systemPrompt ?? systemPrompt;
    const args = buildArgs(params.model, prompt, effectiveSystemPrompt, false);

    console.log("[claude-cli] non-streaming spawn: claude", args.map((a, i) => i === 1 && a !== "-" ? `"${a.slice(0, 80)}..."` : a).join(" "));

    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, {
        stdio: [prompt.length > LONG_PROMPT_THRESHOLD ? "pipe" : "ignore", "pipe", "pipe"],
        env: { ...process.env, CLAUDECODE: undefined },
      });

      if (prompt.length > LONG_PROMPT_THRESHOLD && child.stdin) {
        child.stdin.write(prompt);
        child.stdin.end();
      }

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

      child.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("claude CLI not found. Make sure it is installed and in PATH."));
        } else {
          reject(err);
        }
      });

      child.on("close", (code) => {
        console.log("[claude-cli] non-streaming exited code=%d stdout=%d bytes stderr=%d bytes", code, stdout.length, stderr.length);
        if (stderr) console.log("[claude-cli] stderr:", stderr.slice(0, 500));

        if (code !== 0) {
          resolve({
            text: "",
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            finishReason: "stop",
          });
          return;
        }

        try {
          const lines = stdout.split("\n").filter((l) => l.trim());
          let resultEvent: Record<string, unknown> | null = null;

          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.type === "result") resultEvent = obj;
            } catch { /* skip */ }
          }

          if (!resultEvent) {
            try {
              const arr = JSON.parse(stdout);
              if (Array.isArray(arr)) {
                resultEvent = arr.find((o) => o.type === "result") ?? null;
              } else if (arr.type === "result") {
                resultEvent = arr;
              } else if (arr.result !== undefined) {
                resultEvent = arr;
              }
            } catch { /* not an array either */ }
          }

          if (!resultEvent) {
            resolve({ text: stdout.trim(), tokensIn: 0, tokensOut: 0, costUsd: 0, finishReason: "stop" });
            return;
          }

          const extracted = extractModelUsage(resultEvent);
          const text = (resultEvent.result as string) ?? "";

          if (resultEvent.is_error) {
            resolve({ text: "", tokensIn: extracted.tokensIn, tokensOut: extracted.tokensOut, costUsd: extracted.costUsd, finishReason: "stop" });
            return;
          }

          // Parse tool calls if tools were provided
          if (hasTools && text) {
            const parsed = parseToolCalls(text);
            if (parsed.toolCalls.length > 0) {
              resolve({
                text: parsed.textContent ?? "",
                ...extracted,
                finishReason: "tool_calls",
                toolCalls: parsed.toolCalls,
              });
              return;
            }
          }

          resolve({ text, ...extracted, finishReason: "stop" });
        } catch {
          resolve({ text: stdout.trim(), tokensIn: 0, tokensOut: 0, costUsd: 0, finishReason: "stop" });
        }
      });
    });
  }

  async stream(params: ProviderRequest): Promise<ProviderStreamResponse> {
    const { systemPrompt, prompt, hasTools } = convertMessages(params.messages, params.tools);
    const effectiveSystemPrompt = params.systemPrompt ?? systemPrompt;
    const args = buildArgs(params.model, prompt, effectiveSystemPrompt, true);

    console.log("[claude-cli] streaming spawn: claude", args.map((a, i) => i === 1 && a !== "-" ? `"${a.slice(0, 80)}..."` : a).join(" "));

    const child = spawn("claude", args, {
      stdio: [prompt.length > LONG_PROMPT_THRESHOLD ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDECODE: undefined },
    });

    if (prompt.length > LONG_PROMPT_THRESHOLD && child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    let stderrBuf = "";
    child.stderr?.on("data", (data: Buffer) => { stderrBuf += data.toString(); });
    child.on("error", (err) => { console.error("[claude-cli] spawn error:", err.message); });
    child.on("close", (code) => {
      console.log("[claude-cli] streaming exited code=%d", code);
      if (stderrBuf) console.log("[claude-cli] stderr:", stderrBuf.slice(0, 500));
    });

    const completionId = `chatcmpl-${crypto.randomUUID()}`;
    const model = params.model;

    let resolveMetadata: (value: ProviderResponse) => void;
    const metadata = new Promise<ProviderResponse>((resolve) => { resolveMetadata = resolve; });

    // Create Node-to-Web stream bridge
    let streamClosed = false;
    const nodeToWeb = new ReadableStream<Uint8Array>({
      start(controller) {
        child.stdout!.on("data", (chunk: Buffer) => {
          if (!streamClosed) controller.enqueue(new Uint8Array(chunk));
        });
        child.stdout!.on("end", () => {
          if (!streamClosed) { streamClosed = true; controller.close(); }
        });
        child.stdout!.on("error", (err) => {
          if (!streamClosed) { streamClosed = true; controller.error(err); }
        });
      },
      cancel() {
        streamClosed = true;
        child.kill();
      },
    });

    const transformer = createClaudeNdjsonTransformer(completionId, model, (acc) => {
      resolveMetadata!({
        text: acc.text,
        tokensIn: acc.tokensIn,
        tokensOut: acc.tokensOut,
        costUsd: acc.costUsd,
        finishReason: "stop",
      });
    }, { hasTools });

    const outputStream = nodeToWeb.pipeThrough(transformer);

    return { stream: outputStream, metadata };
  }
}
