import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import type { ClaudeModel } from "./types";

const LONG_PROMPT_THRESHOLD = 100_000; // bytes

/** Extract accurate token counts and cost from the CLI result event's modelUsage field */
function extractModelUsage(resultEvent: Record<string, unknown>): {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
} {
  // modelUsage has per-model breakdown with accurate totals
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

  // Fallback: use total_cost_usd + basic usage fields
  const usage = resultEvent.usage as Record<string, number> | undefined;
  const totalCost = resultEvent.total_cost_usd as number | undefined;
  return {
    tokensIn: (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0),
    tokensOut: usage?.output_tokens ?? 0,
    costUsd: totalCost ?? 0,
  };
}

interface CliOptions {
  model: ClaudeModel;
  prompt: string;
  systemPrompt: string | null;
  streaming: boolean;
}

function buildArgs(options: CliOptions): string[] {
  const args = [
    "-p",
    ...(options.prompt.length <= LONG_PROMPT_THRESHOLD ? [options.prompt] : ["-"]),
    "--output-format",
    options.streaming ? "stream-json" : "json",
    "--model",
    options.model,
    "--verbose",
    "--no-session-persistence",
  ];

  if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt);
  }

  return args;
}

export interface NonStreamingResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  isError: boolean;
  errorMessage?: string;
}

export function spawnClaudeNonStreaming(options: CliOptions): Promise<NonStreamingResult> {
  return new Promise((resolve, reject) => {
    const args = buildArgs(options);
    console.log("[claude-cli] non-streaming spawn: claude", args.map((a, i) => i === 1 && a !== "-" ? `"${a.slice(0, 80)}..."` : a).join(" "));
    const child = spawn("claude", args, {
      stdio: [options.prompt.length > LONG_PROMPT_THRESHOLD ? "pipe" : "ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    if (options.prompt.length > LONG_PROMPT_THRESHOLD && child.stdin) {
      child.stdin.write(options.prompt);
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

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
          isError: true,
          errorMessage: stderr || `claude CLI exited with code ${code}`,
        });
        return;
      }

      try {
        // --verbose outputs NDJSON (multiple JSON objects, one per line)
        // Find the "result" event which contains the final output
        const lines = stdout.split("\n").filter((l) => l.trim());
        let resultEvent: Record<string, unknown> | null = null;

        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "result") {
              resultEvent = obj;
            }
          } catch {
            // Skip non-JSON lines
          }
        }

        // If no separate lines, try parsing the whole stdout as a single JSON array
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
          } catch {
            // Not an array either
          }
        }

        if (!resultEvent) {
          // Fallback: treat entire stdout as plain text
          resolve({
            text: stdout.trim(),
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            isError: false,
          });
          return;
        }

        const extracted = extractModelUsage(resultEvent);

        if (resultEvent.is_error) {
          resolve({
            text: (resultEvent.result as string) ?? "",
            ...extracted,
            isError: true,
            errorMessage: (resultEvent.result as string) ?? "Unknown CLI error",
          });
          return;
        }

        resolve({
          text: (resultEvent.result as string) ?? "",
          ...extracted,
          isError: false,
        });
      } catch {
        resolve({
          text: stdout.trim(),
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          isError: false,
        });
      }
    });
  });
}

export interface StreamingHandle {
  child: ChildProcess;
  stdout: NodeJS.ReadableStream;
}

export function spawnClaudeStreaming(options: CliOptions): StreamingHandle {
  const args = buildArgs(options);
  console.log("[claude-cli] streaming spawn: claude", args.map((a, i) => i === 1 && a !== "-" ? `"${a.slice(0, 80)}..."` : a).join(" "));
  const child = spawn("claude", args, {
    stdio: [options.prompt.length > LONG_PROMPT_THRESHOLD ? "pipe" : "ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  if (options.prompt.length > LONG_PROMPT_THRESHOLD && child.stdin) {
    child.stdin.write(options.prompt);
    child.stdin.end();
  }

  let stderrBuf = "";
  child.stderr?.on("data", (data: Buffer) => {
    stderrBuf += data.toString();
  });

  child.on("error", (err) => {
    console.error("[claude-cli] spawn error:", err.message);
  });

  child.on("close", (code) => {
    console.log("[claude-cli] streaming exited code=%d", code);
    if (stderrBuf) console.log("[claude-cli] stderr:", stderrBuf.slice(0, 500));
  });

  return { child, stdout: child.stdout! };
}
