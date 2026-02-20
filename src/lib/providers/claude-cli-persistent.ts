import { BaseProvider } from "./base";
import type { ProviderModel, ProviderRequest, ProviderResponse, ProviderStreamResponse } from "./base";
import { convertMessages } from "../message-converter";
import { createClaudeNdjsonTransformer } from "../stream-transformers/claude-ndjson";
import { parseToolCalls } from "../tool-parser";
import { PinnedProcess, spawnClaude, buildUserMessage, extractModelUsage } from "../pinned-process";
import { warmPool } from "../warm-pool";
import { getPinnedModel } from "../pinned-model-setting";

/**
 * Persistent Claude CLI provider.
 *
 * Uses the subprocess protocol: --input-format stream-json --output-format stream-json
 *
 * Three dispatch modes (checked in order):
 *
 * 1. **Warm pool** (when pool is running and model is in pool):
 *    Uses pre-spawned persistent processes from the warm pool, one per model.
 *    Eliminates ~5s per-request startup cost. Context is tracked per process
 *    and backfilled when routing to a process missing prior turns.
 *
 * 2. **Pinned** (when pinned model is set via Settings UI or CLAUDE_CLI_MODEL env var):
 *    A single long-lived PinnedProcess for one model, reused across requests.
 *    Simpler than the warm pool — no context tracking, single model only.
 *    Useful for development or when you always use the same model.
 *
 * 3. **Ephemeral** (fallback):
 *    A fresh process is spawned per request with the exact model and system prompt.
 *    Process is killed after the response.
 */

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

// ── Provider ────────────────────────────────────────────────────────────

export type DispatchMode = "warm" | "pinned" | "ephemeral";

export class ClaudeCliPersistentProvider extends BaseProvider {
  readonly id = "claude-cli" as const;
  readonly displayName = "Claude (CLI)";
  private models: ProviderModel[];
  private _lastDispatchMode: DispatchMode = "ephemeral";
  private _lastContextBackfillCount = 0;

  /** Pinned mode: single long-lived process, managed dynamically */
  private _pinnedForModel: string | null = null;
  private _pinnedProcess: PinnedProcess | null = null;

  constructor(models?: ProviderModel[]) {
    super();
    this.models = models ?? [];
  }

  /**
   * Get the pinned process, creating or replacing it if the setting changed.
   * Returns null if pinned mode is disabled (setting is null).
   */
  private getPinnedProcess(): PinnedProcess | null {
    const model = getPinnedModel();
    if (!model) {
      // Pinned mode disabled — destroy existing process if any
      if (this._pinnedProcess) {
        console.log("[claude-persistent] pinned mode disabled, destroying process");
        this._pinnedProcess.destroy();
        this._pinnedProcess = null;
        this._pinnedForModel = null;
      }
      return null;
    }

    // Setting changed to a different model — replace process
    if (model !== this._pinnedForModel) {
      if (this._pinnedProcess) {
        console.log("[claude-persistent] pinned model changed from %s to %s, replacing process",
          this._pinnedForModel, model);
        this._pinnedProcess.destroy();
      }
      console.log("[claude-persistent] pinned mode enabled for model: %s", model);
      this._pinnedProcess = new PinnedProcess(model);
      this._pinnedForModel = model;
    }

    return this._pinnedProcess;
  }

  isAvailable(): boolean {
    return checkClaudeExists();
  }

  getModels(): ProviderModel[] {
    return this.models;
  }

  /** Returns the dispatch mode of the most recent request */
  getLastDispatchMode(): DispatchMode {
    return this._lastDispatchMode;
  }

  /** Returns how many messages were backfilled in the most recent warm dispatch */
  getLastContextBackfillCount(): number {
    return this._lastContextBackfillCount;
  }

  async complete(params: ProviderRequest): Promise<ProviderResponse> {
    const { systemPrompt, prompt, hasTools } = convertMessages(params.messages, params.tools);
    const effectiveSystemPrompt = params.systemPrompt ?? systemPrompt;
    const userMsg = buildUserMessage(prompt);

    // 1. Try warm pool first
    const warmResult = warmPool.getProcessWithContext(params.model, params.messages);
    if (warmResult) {
      const { process: wp, delta } = warmResult;
      console.log("[claude-persistent] non-streaming request via warm pool, model=%s prompt=%d chars backfill=%d msgs",
        params.model, prompt.length, delta.length);
      this._lastDispatchMode = "warm";
      this._lastContextBackfillCount = delta.length;
      warmPool.resetIdleTimer();

      if (delta.length > 0) {
        await this.backfillContext(wp.process, delta);
      }

      return this.completePinned(wp.process, userMsg, hasTools);
    }

    // 2. Try pinned process (single model, no context tracking)
    const pinned = this.getPinnedProcess();
    if (pinned) {
      console.log("[claude-persistent] non-streaming request via pinned process, model=%s prompt=%d chars",
        getPinnedModel(), prompt.length);
      this._lastDispatchMode = "pinned";
      this._lastContextBackfillCount = 0;
      return this.completePinned(pinned, userMsg, hasTools);
    }

    // 3. Ephemeral fallback
    console.log("[claude-persistent] non-streaming request via ephemeral, model=%s prompt=%d chars",
      params.model, prompt.length);
    this._lastDispatchMode = "ephemeral";
    this._lastContextBackfillCount = 0;
    return this.completeEphemeral(params.model, effectiveSystemPrompt, userMsg, hasTools);
  }

  /**
   * Backfill missing conversation context to a warm process.
   * Sends each missing turn as a user message and waits for the process to respond.
   * The response is discarded — we just need the process to absorb the context.
   */
  private async backfillContext(
    pinnedProcess: PinnedProcess,
    delta: Array<{ role: string; content: string }>,
  ): Promise<void> {
    for (const msg of delta) {
      if (msg.role !== "user") continue; // Only user turns trigger process responses

      const backfillMsg = buildUserMessage(msg.content);
      console.log("[claude-persistent] backfilling context: %d chars", msg.content.length);

      const handle = await pinnedProcess.acquire();
      await new Promise<void>((resolve) => {
        let done = false;
        const { release } = handle.send(
          backfillMsg,
          (line) => {
            if (done) return;
            try {
              const event = JSON.parse(line);
              if (event.type === "result") {
                done = true;
                release();
                resolve();
              }
            } catch { /* skip non-JSON */ }
          },
          () => {
            // Process died mid-backfill
            if (!done) {
              done = true;
              resolve();
            }
          },
        );
      });
    }
  }

  private async completePinned(pinnedProcess: PinnedProcess, userMsg: string, hasTools: boolean): Promise<ProviderResponse> {
    const handle = await pinnedProcess.acquire();

    return new Promise<ProviderResponse>((resolve, reject) => {
      let resultEvent: Record<string, unknown> | null = null;
      let assistantText = "";
      let done = false;
      let releaseHandle: (() => void) | null = null;

      const finish = (response: ProviderResponse) => {
        if (done) return;
        done = true;
        releaseHandle?.();
        resolve(response);
      };

      const { release } = handle.send(
        userMsg,
        (line) => {
          try {
            const event = JSON.parse(line);
            if (event.type === "assistant") {
              const content = (event.message as Record<string, unknown>)?.content as Array<Record<string, unknown>> | undefined;
              if (content) {
                for (const block of content) {
                  if (block.type === "text" && typeof block.text === "string") {
                    assistantText += block.text;
                  }
                }
              }
            } else if (event.type === "result") {
              resultEvent = event;
              const extracted = extractModelUsage(resultEvent!);
              const text = assistantText || ((resultEvent!.result as string) ?? "");

              if (resultEvent!.is_error) {
                finish({ text: "", ...extracted, finishReason: "stop" });
                return;
              }

              if (hasTools && text) {
                const parsed = parseToolCalls(text);
                if (parsed.toolCalls.length > 0) {
                  finish({ text: parsed.textContent ?? "", ...extracted, finishReason: "tool_calls", toolCalls: parsed.toolCalls });
                  return;
                }
              }

              finish({ text, ...extracted, finishReason: "stop" });
            }
          } catch { /* skip non-JSON */ }
        },
        () => {
          // Process died mid-request
          if (!done) {
            finish({ text: assistantText || "", tokensIn: 0, tokensOut: 0, costUsd: 0, finishReason: "stop" });
          }
        },
      );

      releaseHandle = release;
    });
  }

  private completeEphemeral(
    model: string,
    systemPrompt: string | null,
    userMsg: string,
    hasTools: boolean,
  ): Promise<ProviderResponse> {
    const child = spawnClaude(model, systemPrompt);

    child.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log("[claude-persistent] stderr:", msg.slice(0, 300));
    });

    return new Promise<ProviderResponse>((resolve, reject) => {
      let stdout = "";
      let resultEvent: Record<string, unknown> | null = null;
      let assistantText = "";
      let done = false;

      const finish = (response: ProviderResponse) => {
        if (done) return;
        done = true;
        try { child.kill(); } catch { /* */ }
        resolve(response);
      };

      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
        const lines = stdout.split("\n");
        stdout = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed);
            if (event.type === "assistant") {
              const content = (event.message as Record<string, unknown>)?.content as Array<Record<string, unknown>> | undefined;
              if (content) {
                for (const block of content) {
                  if (block.type === "text" && typeof block.text === "string") {
                    assistantText += block.text;
                  }
                }
              }
            } else if (event.type === "result") {
              resultEvent = event;
              const extracted = extractModelUsage(resultEvent!);
              const text = assistantText || ((resultEvent!.result as string) ?? "");

              if (resultEvent!.is_error) {
                finish({ text: "", ...extracted, finishReason: "stop" });
                return;
              }

              if (hasTools && text) {
                const parsed = parseToolCalls(text);
                if (parsed.toolCalls.length > 0) {
                  finish({ text: parsed.textContent ?? "", ...extracted, finishReason: "tool_calls", toolCalls: parsed.toolCalls });
                  return;
                }
              }

              finish({ text, ...extracted, finishReason: "stop" });
            }
          } catch { /* skip */ }
        }
      });

      child.on("error", (err) => {
        if (!done) {
          done = true;
          if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            reject(new Error("claude CLI not found. Make sure it is installed and in PATH."));
          } else {
            reject(err);
          }
        }
      });

      child.on("close", (code) => {
        if (!done) {
          console.log("[claude-persistent] ephemeral process closed before result, code=%d", code);
          finish({ text: assistantText || "", tokensIn: 0, tokensOut: 0, costUsd: 0, finishReason: "stop" });
        }
      });

      try {
        child.stdin!.write(userMsg + "\n");
        child.stdin!.end();
      } catch (err) {
        if (!done) { done = true; reject(err as Error); }
      }
    });
  }

  async stream(params: ProviderRequest): Promise<ProviderStreamResponse> {
    const { systemPrompt, prompt, hasTools } = convertMessages(params.messages, params.tools);
    const effectiveSystemPrompt = params.systemPrompt ?? systemPrompt;
    const userMsg = buildUserMessage(prompt);

    // Try warm pool first
    const warmResult = warmPool.getProcessWithContext(params.model, params.messages);
    if (warmResult) {
      const { process: wp, delta } = warmResult;
      console.log("[claude-persistent] streaming request via warm pool, model=%s prompt=%d chars backfill=%d msgs",
        params.model, prompt.length, delta.length);
      this._lastDispatchMode = "warm";
      this._lastContextBackfillCount = delta.length;
      warmPool.resetIdleTimer();

      // Backfill missing context if needed
      if (delta.length > 0) {
        await this.backfillContext(wp.process, delta);
      }

      return this.streamPinned(wp.process, params.model, userMsg, hasTools);
    }

    // 2. Try pinned process
    const pinnedStream = this.getPinnedProcess();
    if (pinnedStream) {
      console.log("[claude-persistent] streaming request via pinned process, model=%s prompt=%d chars",
        getPinnedModel(), prompt.length);
      this._lastDispatchMode = "pinned";
      this._lastContextBackfillCount = 0;
      return this.streamPinned(pinnedStream, params.model, userMsg, hasTools);
    }

    // 3. Ephemeral fallback
    console.log("[claude-persistent] streaming request via ephemeral, model=%s prompt=%d chars",
      params.model, prompt.length);
    this._lastDispatchMode = "ephemeral";
    this._lastContextBackfillCount = 0;
    return this.streamEphemeral(params.model, effectiveSystemPrompt, userMsg, hasTools);
  }

  private async streamPinned(
    pinnedProcess: PinnedProcess,
    model: string,
    userMsg: string,
    hasTools: boolean,
  ): Promise<ProviderStreamResponse> {
    const handle = await pinnedProcess.acquire();
    const completionId = `chatcmpl-${crypto.randomUUID()}`;

    let resolveMetadata: (value: ProviderResponse) => void;
    const metadata = new Promise<ProviderResponse>((resolve) => { resolveMetadata = resolve; });

    const encoder = new TextEncoder();
    let streamClosed = false;
    let releaseHandle: (() => void) | null = null;

    const nodeToWeb = new ReadableStream<Uint8Array>({
      start(controller) {
        const { release } = handle.send(
          userMsg,
          (line) => {
            if (streamClosed) return;
            controller.enqueue(encoder.encode(line + "\n"));
            // When the "result" event arrives, close the stream so the
            // transformer's flush() fires (pinned process stays alive).
            try {
              const event = JSON.parse(line);
              if (event.type === "result") {
                streamClosed = true;
                controller.close();
              }
            } catch { /* not JSON, keep going */ }
          },
          () => {
            // Process died — close the stream
            if (!streamClosed) { streamClosed = true; controller.close(); }
          },
        );
        releaseHandle = release;
      },
      cancel() {
        streamClosed = true;
        releaseHandle?.();
      },
    });

    const transformer = createClaudeNdjsonTransformer(completionId, model, (acc) => {
      releaseHandle?.();
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

  private streamEphemeral(
    model: string,
    systemPrompt: string | null,
    userMsg: string,
    hasTools: boolean,
  ): ProviderStreamResponse {
    const child = spawnClaude(model, systemPrompt);
    const completionId = `chatcmpl-${crypto.randomUUID()}`;

    child.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log("[claude-persistent] stderr:", msg.slice(0, 300));
    });
    child.on("error", (err) => {
      console.error("[claude-persistent] ephemeral spawn error:", err.message);
    });
    child.on("close", (code) => {
      console.log("[claude-persistent] ephemeral streaming exited code=%d", code);
    });

    let resolveMetadata: (value: ProviderResponse) => void;
    const metadata = new Promise<ProviderResponse>((resolve) => { resolveMetadata = resolve; });

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
        try { child.kill(); } catch { /* */ }
      },
    });

    const transformer = createClaudeNdjsonTransformer(completionId, model, (acc) => {
      try { child.kill(); } catch { /* */ }
      resolveMetadata!({
        text: acc.text,
        tokensIn: acc.tokensIn,
        tokensOut: acc.tokensOut,
        costUsd: acc.costUsd,
        finishReason: "stop",
      });
    }, { hasTools });

    const outputStream = nodeToWeb.pipeThrough(transformer);

    try {
      child.stdin!.write(userMsg + "\n");
      child.stdin!.end();
    } catch (err) {
      try { child.kill(); } catch { /* */ }
      throw err;
    }

    return { stream: outputStream, metadata };
  }
}
