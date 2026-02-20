/**
 * Warm Pool Manager for Claude CLI persistent processes.
 *
 * Maintains one pre-spawned PinnedProcess per enabled claude-cli model.
 * Tracks conversation context per process so that when routing switches
 * models, missing context can be backfilled before the actual request.
 *
 * Singleton via globalThis — survives Next.js hot reloads.
 */

import { createHash } from "crypto";
import { PinnedProcess } from "./pinned-process";
import type { ChatMessage } from "./types";

// ── Types ──────────────────────────────────────────────────────────────

/** Digest of a message for fast context comparison */
export interface MessageDigest {
  role: string;
  contentHash: string;
  content: string; // Original content kept for backfill replay
}

export type WarmProcessStatus = "idle" | "busy" | "dead" | "starting";

export interface WarmProcessInfo {
  modelId: string;
  displayName: string;
  status: WarmProcessStatus;
  pid: number | null;
  requestsServed: number;
  lastUsedAt: number | null;
  contextDepth: number; // How many messages in the context log
}

export interface WarmPoolStatus {
  running: boolean;
  startedAt: number | null;
  idleTimeoutMs: number;
  models: WarmProcessInfo[];
}

// ── WarmProcess ────────────────────────────────────────────────────────

/** Wrapper around PinnedProcess with context tracking */
class WarmProcess {
  readonly process: PinnedProcess;
  readonly modelId: string;
  readonly displayName: string;
  contextLog: MessageDigest[] = [];
  requestsServed = 0;
  lastUsedAt: number | null = null;

  constructor(modelId: string, displayName: string) {
    this.modelId = modelId;
    this.displayName = displayName;
    this.process = new PinnedProcess(modelId);
  }

  get status(): WarmProcessStatus {
    if (this.process.isDead) return "dead";
    if (this.process.isBusy) return "busy";
    return "idle";
  }

  get pid(): number | null {
    return this.process.pid;
  }

  /**
   * How many messages from the start of `incoming` match this process's context.
   * Uses prefix matching: context must match from the beginning.
   */
  getContextOverlap(incoming: MessageDigest[]): number {
    let overlap = 0;
    const len = Math.min(this.contextLog.length, incoming.length);
    for (let i = 0; i < len; i++) {
      if (
        this.contextLog[i].role === incoming[i].role &&
        this.contextLog[i].contentHash === incoming[i].contentHash
      ) {
        overlap++;
      } else {
        break; // Prefix match only
      }
    }
    return overlap;
  }

  /**
   * Return messages from `incoming` that this process hasn't seen.
   * Only returns the tail after the overlap prefix.
   */
  getContextDelta(incoming: MessageDigest[]): MessageDigest[] {
    const overlap = this.getContextOverlap(incoming);
    return incoming.slice(overlap);
  }

  /** Record that these messages are now part of this process's context */
  appendToContextLog(digests: MessageDigest[]): void {
    this.contextLog.push(...digests);
  }

  /** Replace context log entirely (e.g., after process respawn) */
  resetContextLog(): void {
    this.contextLog = [];
  }

  destroy(): void {
    this.process.destroy();
    this.contextLog = [];
  }
}

// ── WarmPoolManager ────────────────────────────────────────────────────

class WarmPoolManager {
  private processes: Map<string, WarmProcess> = new Map();
  private running = false;
  private startedAt: number | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private idleTimeoutMs: number;

  constructor() {
    this.idleTimeoutMs = parseInt(process.env.WARM_POOL_IDLE_TIMEOUT_MS ?? "1800000", 10); // 30 min default
  }

  /** Start the warm pool: spawn one process per enabled claude-cli model from DB */
  async start(): Promise<void> {
    if (this.running) {
      console.log("[warm-pool] already running, use restart() to refresh");
      return;
    }

    // Dynamic import to avoid circular dependency
    const { loadModelsForProvider } = await import("./providers");
    const models = await loadModelsForProvider("claude-cli");

    if (models.length === 0) {
      console.log("[warm-pool] no enabled claude-cli models found in DB, not starting");
      return;
    }

    this.startWithModelList(models);
  }

  /** Start the warm pool with an explicit list of models (useful for testing) */
  async startWithModels(models: Array<{ id: string; displayName: string }>): Promise<void> {
    if (this.running) {
      console.log("[warm-pool] already running, use restart() to refresh");
      return;
    }
    this.startWithModelList(models);
  }

  private startWithModelList(models: Array<{ id: string; displayName: string }>): void {
    console.log("[warm-pool] starting with %d models: %s",
      models.length, models.map((m) => m.id).join(", "));

    for (const model of models) {
      const wp = new WarmProcess(model.id, model.displayName);
      this.processes.set(model.id, wp);
    }

    this.running = true;
    this.startedAt = Date.now();
    this.resetIdleTimer();

    console.log("[warm-pool] started successfully");
  }

  /** Stop the warm pool: kill all processes */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log("[warm-pool] stopping, killing %d processes", this.processes.size);

    for (const wp of this.processes.values()) {
      wp.destroy();
    }
    this.processes.clear();

    this.running = false;
    this.startedAt = null;
    this.clearIdleTimer();

    console.log("[warm-pool] stopped");
  }

  /** Restart: stop then start (picks up model config changes) */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Get a warm process for a model with context delta computation.
   *
   * Returns the WarmProcess and the messages that need to be backfilled
   * (delta between what the process has seen and what the request contains).
   *
   * Returns null if pool is not running or model not in pool.
   */
  getProcessWithContext(
    modelId: string,
    messages: ChatMessage[],
  ): { process: WarmProcess; delta: Array<{ role: string; content: string }> } | null {
    if (!this.running) return null;

    const wp = this.processes.get(modelId);
    if (!wp) return null;

    // If process died, it will self-heal on next acquire() call,
    // but we need to reset context since the new process starts fresh
    if (wp.process.isDead) {
      wp.resetContextLog();
    }

    // Hash incoming messages for comparison
    const incoming = digestMessages(messages);

    // Compute delta
    const delta = wp.getContextDelta(incoming);

    // The delta includes the final user message (the actual request).
    // We need to separate backfill messages from the actual request.
    // Backfill = all delta messages except the last one (which is the new user message).
    // The caller handles the last message as the actual request.
    const backfillMessages = delta.length > 1
      ? delta.slice(0, -1).map((d) => ({ role: d.role, content: d.content }))
      : [];

    // After dispatch, the caller should update context log with all incoming messages
    // We update here proactively (the incoming messages represent the full conversation)
    wp.contextLog = incoming;
    wp.requestsServed++;
    wp.lastUsedAt = Date.now();

    return { process: wp, delta: backfillMessages };
  }

  /** Get current pool status */
  getStatus(): WarmPoolStatus {
    return {
      running: this.running,
      startedAt: this.startedAt,
      idleTimeoutMs: this.idleTimeoutMs,
      models: Array.from(this.processes.values()).map((wp) => ({
        modelId: wp.modelId,
        displayName: wp.displayName,
        status: wp.status,
        pid: wp.pid,
        requestsServed: wp.requestsServed,
        lastUsedAt: wp.lastUsedAt,
        contextDepth: wp.contextLog.length,
      })),
    };
  }

  /** Reset idle timer — called on every warm pool dispatch */
  resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      console.log("[warm-pool] idle timeout (%dms), stopping pool", this.idleTimeoutMs);
      this.stop();
    }, this.idleTimeoutMs);
    // Don't keep the process alive just for the timer
    if (this.idleTimer.unref) {
      this.idleTimer.unref();
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Hash a message's content for fast comparison */
function hashContent(content: string | Array<{ type: string; text?: string }>): string {
  const text = typeof content === "string"
    ? content
    : content.map((p) => p.text ?? "").join("");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Extract plain text from a ChatMessage content field */
function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content.map((p) => p.text ?? "").join("");
}

/** Convert ChatMessage[] to MessageDigest[] */
function digestMessages(messages: ChatMessage[]): MessageDigest[] {
  return messages.map((m) => ({
    role: m.role,
    contentHash: hashContent(m.content as string | Array<{ type: string; text?: string }>),
    content: extractText(m.content as string | Array<{ type: string; text?: string }>),
  }));
}

// ── Singleton ──────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __warmPool: WarmPoolManager | undefined;
}

export const warmPool: WarmPoolManager =
  globalThis.__warmPool ?? (globalThis.__warmPool = new WarmPoolManager());
