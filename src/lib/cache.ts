import { createHash } from "crypto";
import type { ChatCompletionResponse } from "./types";

interface CacheEntry {
  response: ChatCompletionResponse;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const dedupWindow = new Map<string, number>();

const DEFAULT_TTL = 60_000; // 60 seconds
const DEDUP_TTL = 5_000; // 5 seconds

function hashKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("||")).digest("hex");
}

export function getCacheKey(model: string, systemPrompt: string | null, messages: { role: string; content: string | unknown[] | null }[]): string {
  const msgStr = JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content })));
  return hashKey([model, systemPrompt ?? "", msgStr]);
}

export function getDedupKey(lastUserMessage: string): string {
  return hashKey([lastUserMessage]);
}

export function getFromCache(key: string): ChatCompletionResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > DEFAULT_TTL) {
    cache.delete(key);
    return null;
  }

  return entry.response;
}

export function setInCache(key: string, response: ChatCompletionResponse): void {
  cache.set(key, { response, timestamp: Date.now() });
}

export function isDuplicate(key: string): boolean {
  const ts = dedupWindow.get(key);
  if (!ts) return false;
  if (Date.now() - ts > DEDUP_TTL) {
    dedupWindow.delete(key);
    return false;
  }
  return true;
}

export function markDedup(key: string): void {
  dedupWindow.set(key, Date.now());
}

/** Clear dedup window only (for testing) */
export function clearDedup(): void {
  dedupWindow.clear();
}

/** Clear all cache and dedup state (for testing) */
export function clearCache(): void {
  cache.clear();
  dedupWindow.clear();
}

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > DEFAULT_TTL) cache.delete(key);
  }
  for (const [key, ts] of dedupWindow) {
    if (now - ts > DEDUP_TTL) dedupWindow.delete(key);
  }
}, 30_000);
