/**
 * Shared PinnedProcess class and helpers for the Claude CLI subprocess protocol.
 *
 * Used by both the warm pool manager and the persistent provider.
 * Manages a single long-lived Claude subprocess using --input-format stream-json.
 */

import { spawn } from "child_process";
import type { ChildProcess } from "child_process";

/**
 * Spawn a Claude CLI subprocess with the stream-json protocol.
 */
export function spawnClaude(model?: string, systemPrompt?: string | null): ChildProcess {
  const args = [
    "-p", "-",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
  ];

  if (model) {
    args.push("--model", model);
  }

  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  console.log("[claude-persistent] spawning: claude -p - --model %s --system-prompt [%d chars]",
    model ?? "(default)", systemPrompt?.length ?? 0);

  return spawn("claude", args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CLAUDECODE: undefined },
  });
}

/**
 * Extract token usage and cost from a result event.
 */
export function extractModelUsage(resultEvent: Record<string, unknown>): {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
} {
  const modelUsage = resultEvent.modelUsage as Record<string, Record<string, number>> | undefined;
  if (modelUsage) {
    let tokensIn = 0;
    let tokensOut = 0;
    let costUsd = 0;
    for (const m of Object.values(modelUsage)) {
      tokensIn += (m.inputTokens ?? 0) + (m.cacheReadInputTokens ?? 0) + (m.cacheCreationInputTokens ?? 0);
      tokensOut += m.outputTokens ?? 0;
      costUsd += m.costUSD ?? 0;
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

/**
 * Build a stream-json protocol user message.
 */
export function buildUserMessage(prompt: string): string {
  return JSON.stringify({
    type: "user",
    session_id: "",
    message: {
      role: "user",
      content: [{ type: "text", text: prompt }],
    },
    parent_tool_use_id: null,
  });
}

/**
 * Keeps a single long-lived Claude process for a specific model.
 * Requests are serialized: one at a time, queued if busy.
 *
 * The process stdout emits NDJSON for ALL requests sequentially.
 * We use a single stdout listener that dispatches lines to the
 * current active request handler. When a "result" event arrives,
 * the active request is complete and the next queued request is sent.
 */
export class PinnedProcess {
  private child: ChildProcess | null = null;
  private model: string;
  private busy = false;
  private stdoutBuffer = "";
  private activeHandler: ((line: string) => void) | null = null;
  private activeCloseHandler: (() => void) | null = null;
  private queue: Array<() => void> = [];

  constructor(model: string) {
    this.model = model;
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get isDead(): boolean {
    return !this.child || this.child.killed || this.child.exitCode !== null;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  private ensureProcess(): ChildProcess {
    if (this.child && !this.child.killed && this.child.exitCode === null) {
      return this.child;
    }
    console.log("[claude-persistent] starting pinned process for model=%s", this.model);
    const child = spawnClaude(this.model);

    child.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) console.log("[claude-persistent] stderr:", msg.slice(0, 300));
    });

    child.on("error", (err) => {
      console.error("[claude-persistent] pinned process error:", err.message);
      this.handleProcessDeath();
    });

    child.on("close", (code) => {
      console.log("[claude-persistent] pinned process exited code=%d, will respawn on next request", code);
      this.handleProcessDeath();
    });

    // Single stdout listener that dispatches to the active request handler
    child.stdout!.on("data", (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (this.activeHandler) {
          this.activeHandler(trimmed);
        }
      }
    });

    this.child = child;
    return child;
  }

  private handleProcessDeath() {
    this.child = null;
    // Notify active request that the process died
    if (this.activeCloseHandler) {
      this.activeCloseHandler();
      this.activeHandler = null;
      this.activeCloseHandler = null;
    }
    this.busy = false;
    this.stdoutBuffer = "";
    this.drainQueue();
  }

  private drainQueue() {
    if (this.queue.length > 0 && !this.busy) {
      const next = this.queue.shift()!;
      next();
    }
  }

  /**
   * Send a message and call onLine for each NDJSON line of the response.
   * Returns a release function to call when the request is done.
   */
  send(
    userMsg: string,
    onLine: (line: string) => void,
    onClose: () => void,
  ): { child: ChildProcess; release: () => void } {
    const child = this.ensureProcess();
    this.busy = true;
    this.activeHandler = onLine;
    this.activeCloseHandler = onClose;

    child.stdin!.write(userMsg + "\n");

    return {
      child,
      release: () => {
        this.activeHandler = null;
        this.activeCloseHandler = null;
        this.busy = false;
        this.drainQueue();
      },
    };
  }

  /**
   * Acquire exclusive access to send a request.
   * If busy, queues the caller until the current request completes.
   */
  acquire(): Promise<{
    send: (
      userMsg: string,
      onLine: (line: string) => void,
      onClose: () => void,
    ) => { child: ChildProcess; release: () => void };
  }> {
    return new Promise((resolve) => {
      const go = () => {
        resolve({
          send: (msg, onLine, onClose) => this.send(msg, onLine, onClose),
        });
      };
      if (!this.busy) {
        go();
      } else {
        this.queue.push(go);
      }
    });
  }

  destroy() {
    if (this.child) {
      try { this.child.kill(); } catch { /* */ }
      this.child = null;
    }
    this.queue = [];
    this.busy = false;
  }
}
