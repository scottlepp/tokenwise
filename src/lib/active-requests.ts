/**
 * In-memory store for currently active (streaming) LLM requests.
 * Provides real-time visibility into what the proxy is currently doing.
 * Note: single-process only -- not shared across Next.js instances.
 */

export interface ActiveRequest {
  taskId: string;
  requestId: string;
  provider: string;
  model: string;
  category: string;
  promptPreview: string;
  partialText: string;
  tokensIn: number;
  tokensOut: number;
  startedAt: number; // Date.now()
}

// Global singleton -- survives hot reloads in Next.js dev mode via globalThis
declare global {
  // eslint-disable-next-line no-var
  var __activeRequests: Map<string, ActiveRequest> | undefined;
}

const activeRequests: Map<string, ActiveRequest> =
  globalThis.__activeRequests ?? (globalThis.__activeRequests = new Map());

export function registerRequest(taskId: string, info: Omit<ActiveRequest, "taskId" | "partialText" | "startedAt">): void {
  activeRequests.set(taskId, {
    taskId,
    partialText: "",
    startedAt: Date.now(),
    ...info,
  });
}

export function appendChunk(taskId: string, text: string): void {
  const req = activeRequests.get(taskId);
  if (req) {
    req.partialText += text;
    req.tokensOut = Math.ceil(req.partialText.length / 4); // rough estimate
  }
}

export function updateTokens(taskId: string, tokensIn: number, tokensOut: number): void {
  const req = activeRequests.get(taskId);
  if (req) {
    req.tokensIn = tokensIn;
    req.tokensOut = tokensOut;
  }
}

export function completeRequest(taskId: string): void {
  activeRequests.delete(taskId);
}

const STALE_REQUEST_TIMEOUT_MS = 120_000; // 2 minutes

export function cleanupStaleRequests(): void {
  const now = Date.now();
  const staleIds: string[] = [];
  
  for (const [taskId, req] of activeRequests.entries()) {
    if (now - req.startedAt > STALE_REQUEST_TIMEOUT_MS) {
      staleIds.push(taskId);
    }
  }
  
  if (staleIds.length > 0) {
    console.warn(`[active-requests] Cleaning up ${staleIds.length} stale requests:`, staleIds);
    for (const id of staleIds) {
      activeRequests.delete(id);
    }
  }
}

export function getActiveRequests(): ActiveRequest[] {
  // Clean up stale requests on every fetch
  cleanupStaleRequests();
  return Array.from(activeRequests.values());
}
