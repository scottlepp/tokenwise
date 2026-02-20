import { NextRequest, NextResponse } from "next/server";
import { selectModel } from "@/lib/router";
import { evaluate } from "@/lib/success-evaluator";
import { modelAlias, RESPONSE_MODEL } from "@/lib/config";
import {
  insertTaskLog, insertRequestLog, insertStatusLog, updateRequestStatus,
  updateUserRating, getMostRecentTaskId, findTaskByPartialId,
} from "@/lib/db/queries";
import { getCacheKey, getDedupKey, getFromCache, setInCache, isDuplicate, markDedup } from "@/lib/cache";
import { compress } from "@/lib/compressor";
import { checkBudget, downgradeModel } from "@/lib/budget";
import { providerRegistry, initializeProviders } from "@/lib/providers";
import type { ChatCompletionRequest, ChatCompletionResponse, PipelineStep } from "@/lib/types";
import { registerRequest, completeRequest, updateTokens, appendChunk } from "@/lib/active-requests";
import type { ClaudeCliPersistentProvider } from "@/lib/providers/claude-cli-persistent";

// RESPONSE_MODEL is imported from @/lib/config — keeps clients like Cline happy

// Force Node.js runtime + no static optimization — required for streaming
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Log a pipeline step. Fire-and-forget — never blocks the pipeline on logging failures. */
function logStep(
  requestId: string,
  step: PipelineStep,
  status: "started" | "completed" | "error" | "skipped",
  detail?: string,
  durationMs?: number,
) {
  insertStatusLog({ requestId, step, status, detail, durationMs }).catch(() => {});
}


/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within the timeout,
 * rejects with a TimeoutError.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`[${context}] Promise timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

function errorResponse(message: string, code: string, status: number) {
  return NextResponse.json(
    { error: { message, type: "invalid_request_error", code } },
    { status }
  );
}

function parseFeedbackCommand(text: string): { rating: number; taskId?: string } | null {
  const match = text.match(/^\/feedback\s+(.+)/i);
  if (!match) return null;

  const parts = match[1].trim().split(/\s+/);
  const first = parts[0].toLowerCase();
  const second = parts[1];

  let rating: number;
  if (first === "good") rating = 5;
  else if (first === "bad") rating = 1;
  else {
    const num = parseInt(first, 10);
    if (isNaN(num) || num < 1 || num > 5) return null;
    rating = num;
  }

  return { rating, taskId: second };
}

async function handleFeedback(
  rating: number,
  taskId: string | undefined,
  requestModel: string
): Promise<NextResponse> {
  let resolvedId: string | null = null;
  let taskInfo = "";

  if (taskId) {
    const task = await findTaskByPartialId(taskId);
    if (task) {
      resolvedId = task.id;
      taskInfo = `Task ${task.id.slice(0, 8)}: ${task.taskCategory} (${task.modelSelected})`;
    }
  } else {
    resolvedId = await getMostRecentTaskId();
    if (resolvedId) {
      taskInfo = `Most recent task ${resolvedId.slice(0, 8)}`;
    }
  }

  if (!resolvedId) {
    return errorResponse("No task found to rate", "not_found", 404);
  }

  await updateUserRating(resolvedId, rating);

  const ratingLabel = rating >= 4 ? "positive" : rating <= 2 ? "negative" : "neutral";
  const responseText = `Feedback recorded: ${ratingLabel} (${rating}/5) for ${taskInfo}`;

  const response: ChatCompletionResponse = {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestModel,
    choices: [{ index: 0, message: { role: "assistant", content: responseText }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };

  return NextResponse.json(response);
}

export async function POST(request: NextRequest) {
  const requestStart = Date.now();
  const userAgent = request.headers.get("user-agent") ?? "";

  // Ensure providers are initialized
  await initializeProviders();

  // ── Parse request body ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: ChatCompletionRequest & Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", "invalid_json", 400);
  }

  const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;
  // Pass through tool_choice from the client. Only default to "none" when no tools are present,
  // so agentic clients (Cline) that send tool_choice="auto" or "required" work correctly.
  const toolChoice = body.tool_choice ?? (toolCount > 0 ? "auto" : "none");

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return errorResponse("messages array is required and must not be empty", "invalid_messages", 400);
  }

  const requestModel = body.model ?? "auto";
  const streaming = body.stream === true;

  // Extract last user message text (used in multiple places)
  function extractText(msg: { content: unknown }): string {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content))
      return msg.content.filter((p: { type: string }) => p.type === "text").map((p: { text: string }) => p.text).join("");
    return "";
  }

  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUserMsg ? extractText(lastUserMsg) : "";

  // For prompt preview, skip system/error messages from agentic clients
  const promptPreviewText = (() => {
    const reversed = [...body.messages].reverse();
    for (const m of reversed) {
      if (m.role !== "user") continue;
      const t = extractText(m);
      if (/^\[ERROR\]|^# Reminder:|^<feedback>/.test(t.trim())) continue;
      return t;
    }
    return lastUserText;
  })();

  // ── Create request log ──
  let requestId: string;
  try {
    requestId = await insertRequestLog({
      userAgent: userAgent.slice(0, 500),
      modelRequested: requestModel,
      messageCount: body.messages.length,
      toolCount,
      streaming,
      promptPreview: lastUserText.slice(0, 500),
    });
  } catch {
    requestId = crypto.randomUUID();
  }

  logStep(requestId, "parse", "completed", JSON.stringify({
    model: requestModel, streaming, messages: body.messages.length, tools: toolCount,
  }), Date.now() - requestStart);

  // ── 1. Check for /feedback command ──
  if (lastUserMsg) {
    const text = typeof lastUserMsg.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg.content)
        ? lastUserMsg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")
        : "";
    const feedback = parseFeedbackCommand(text.trim());
    if (feedback) {
      logStep(requestId, "feedback", "completed", `rating=${feedback.rating} taskId=${feedback.taskId ?? "latest"}`);
      updateRequestStatus(requestId, "completed", { httpStatus: 200, totalLatencyMs: Date.now() - requestStart }).catch(() => {});
      return handleFeedback(feedback.rating, feedback.taskId, RESPONSE_MODEL);
    }
  }

  // ── 2. Check dedup window ──
  const dedupKey = getDedupKey(lastUserText);
  if (isDuplicate(dedupKey) && !streaming) {
    logStep(requestId, "dedup", "completed", "duplicate detected");
    updateRequestStatus(requestId, "deduped", { httpStatus: 429, totalLatencyMs: Date.now() - requestStart }).catch(() => {});
    return errorResponse("Duplicate request detected, please wait", "duplicate_request", 429);
  }
  markDedup(dedupKey);

  // ── 3. Classify + Route (cross-provider) ──
  let decision;
  const classifyStart = Date.now();
  logStep(requestId, "classify", "started");

  try {
    const result = await selectModel(requestModel, body.messages);
    decision = result.decision;
    const classifyDetail: Record<string, unknown> = {
      provider: decision.provider,
      category: decision.category,
      complexityScore: decision.complexityScore,
    };
    if (result.classificationLlm) {
      classifyDetail.llm = result.classificationLlm;
    }
    logStep(requestId, "classify", "completed", JSON.stringify(classifyDetail), Date.now() - classifyStart);
  } catch {
    const { classifyTaskHeuristic } = await import("@/lib/task-classifier");
    const classification = classifyTaskHeuristic(body.messages);
    decision = {
      provider: "claude-cli",
      model: "claude-sonnet-4-5-20250929",
      alias: "sonnet",
      reason: "Router error, defaulting to sonnet",
      category: classification.category,
      complexityScore: classification.complexityScore,
    };
    logStep(requestId, "classify", "error", "Router error, used heuristic fallback", Date.now() - classifyStart);
  }

  logStep(requestId, "route", "completed", JSON.stringify({
    provider: decision.provider, model: decision.alias, reason: decision.reason,
    category: decision.category, complexityScore: decision.complexityScore,
  }));

  // ── 3.5. Enforce minimum model for agentic clients ──
  // Agentic clients (Cline, Aider, etc.) always need at least sonnet.
  // Cline uses its own XML-based tool protocol (attempt_completion, read_file, etc.)
  // embedded in message content (NOT in OpenAI tools[]), and haiku is too unreliable
  // at following these protocols, causing ERROR retry loops that waste tokens.
  const isAgenticClient = /cline|aider|continue|copilot/i.test(userAgent);
  if (isAgenticClient && decision.model === "claude-haiku-4-5-20251001") {
    console.log("[completions]    → agentic client upgrade: haiku → sonnet (agentic client always needs sonnet)");
    decision = {
      ...decision,
      model: "claude-sonnet-4-5-20250929",
      alias: "sonnet",
      reason: `${decision.reason} -> upgraded to sonnet (agentic client)`,
    };
    logStep(requestId, "route", "completed", "upgraded haiku->sonnet (agentic client)");
  }

  // ── 4. Budget check ──
  console.log("[completions] 4. BUDGET CHECK");
  const budgetStart = Date.now();
  const budgetResult = await checkBudget();
  if (!budgetResult.allowed) {
    console.log("[completions]    → BLOCKED: %s", budgetResult.reason);
    logStep(requestId, "budget_check", "error", budgetResult.reason, Date.now() - budgetStart);
    updateRequestStatus(requestId, "error", { httpStatus: 429, errorMessage: budgetResult.reason, totalLatencyMs: Date.now() - requestStart }).catch(() => {});
    return errorResponse(budgetResult.reason, "budget_exceeded", 429);
  }
  if (budgetResult.downgrade) {
    const downgraded = downgradeModel(decision.model);
    decision = {
      ...decision,
      model: downgraded,
      alias: modelAlias(downgraded),
      reason: `${decision.reason} -> downgraded due to budget (${budgetResult.reason})`,
    };
    console.log("[completions]    → downgraded to %s (%s)", decision.alias, budgetResult.reason);
  } else {
    const remaining = budgetResult.remainingUsd === Infinity ? "unlimited" : `$${budgetResult.remainingUsd.toFixed(2)} remaining`;
    console.log("[completions]    → OK (%s)", remaining);
  }
  logStep(requestId, "budget_check", "completed", JSON.stringify({
    allowed: true, downgrade: budgetResult.downgrade, remainingUsd: budgetResult.remainingUsd,
  }), Date.now() - budgetStart);

  // ── 5. Check cache (non-streaming only) ──
  if (!streaming) {
    console.log("[completions] 5. CACHE CHECK");
    const cacheStart = Date.now();
    const cacheKey = getCacheKey(`${decision.provider}:${decision.model}`, null, body.messages);
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log("[completions]    → HIT — returning cached response");
      logStep(requestId, "cache_check", "completed", "cache hit", Date.now() - cacheStart);

      try {
        await insertTaskLog({
          requestId,
          provider: decision.provider,
          taskCategory: decision.category,
          complexityScore: decision.complexityScore,
          promptSummary: lastUserText.slice(0, 500),
          messageCount: body.messages.length,
          modelRequested: requestModel,
          modelSelected: decision.model,
          routerReason: decision.reason + " (cache hit)",
          tokensIn: 0,
          tokensOut: 0,
          costUsd: "0",
          latencyMs: 0,
          streaming: false,
          cliSuccess: true,
          heuristicScore: 100,
          cacheHit: true,
        });
      } catch {
        // Ignore logging errors
      }

      logStep(requestId, "response_sent", "completed", "cache hit");
      updateRequestStatus(requestId, "cached", { httpStatus: 200, totalLatencyMs: Date.now() - requestStart }).catch(() => {});

      return NextResponse.json(cached, {
        headers: {
          "x-request-id": requestId,
          "x-cache-hit": "true",
          "x-provider": decision.provider,
          "x-model": decision.alias,
        },
      });
    }
    console.log("[completions]    → MISS (%dms)", Date.now() - cacheStart);
    logStep(requestId, "cache_check", "completed", "cache miss", Date.now() - cacheStart);
  }

  // ── 6. Compress messages ──
  console.log("[completions] 6. COMPRESS");
  const compressStart = Date.now();
  const compressionResult = compress(body.messages);
  const tokensSaved = compressionResult.tokensBefore - compressionResult.tokensAfter;
  console.log("[completions]    → tokens %d → %d (saved %d) (%dms)",
    compressionResult.tokensBefore, compressionResult.tokensAfter, tokensSaved, Date.now() - compressStart);
  logStep(requestId, "compress", "completed", JSON.stringify({
    tokensBefore: compressionResult.tokensBefore,
    tokensAfter: compressionResult.tokensAfter,
    saved: tokensSaved,
  }), Date.now() - compressStart);

  // ── 7. Get provider and dispatch ──
  console.log("[completions] 7. DISPATCH → %s / %s  stream=%s",
    decision.provider, decision.model, streaming);
  const provider = providerRegistry.get(decision.provider);
  if (!provider) {
    const errMsg = `Provider ${decision.provider} not available`;
    logStep(requestId, "provider_dispatch", "error", errMsg);
    updateRequestStatus(requestId, "error", { httpStatus: 500, errorMessage: errMsg, totalLatencyMs: Date.now() - requestStart }).catch(() => {});
    return errorResponse(errMsg, "provider_unavailable", 500);
  }

  const dispatchStart = Date.now();
  const completionId = `chatcmpl-${crypto.randomUUID()}`;
  const promptSummary = lastUserText.slice(0, 500);

  updateRequestStatus(requestId, "processing").catch(() => {});

  const providerRequest = {
    model: decision.model,
    messages: compressionResult.messages,
    tools: body.tools,
    toolChoice: toolChoice,  // use corrected value (not raw body.tool_choice which may be undefined)
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    stream: streaming,
  };

  // Helper to get dispatch mode after provider call completes
  const getDispatchInfo = () => {
    if (decision.provider === "claude-cli" && "getLastDispatchMode" in provider) {
      const cliProvider = provider as unknown as ClaudeCliPersistentProvider;
      const mode = cliProvider.getLastDispatchMode();
      const backfillCount = cliProvider.getLastContextBackfillCount();
      return { dispatchMode: mode, backfillCount };
    }
    return { dispatchMode: undefined, backfillCount: 0 };
  };

  if (streaming) {
    // ── Streaming path ──
    logStep(requestId, "provider_dispatch", "started", JSON.stringify({
      provider: decision.provider, model: decision.model, streaming: true,
    }));

    try {
      const streamResult = await provider.stream(providerRequest);
      console.log("[completions]    → stream opened (%dms to first byte)", Date.now() - dispatchStart);

      logStep(requestId, "provider_streaming", "started");

      // Register in active requests store for real-time activity page
      registerRequest(requestId, {
        requestId,
        provider: decision.provider,
        model: decision.alias || decision.model,
        category: decision.category,
        promptPreview: promptPreviewText.slice(0, 200),
        tokensIn: 0,
        tokensOut: 0,
      });

      // Wrap the stream to intercept text chunks for live activity display
      let firstChunkLogged = false;
      let chunkCount = 0;
      const activityTracker = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
          chunkCount++;
          // Parse SSE chunks to extract text for appendChunk
          try {
            const text = new TextDecoder().decode(chunk);
            for (const line of text.split("\n")) {
              if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
              const parsed = JSON.parse(line.slice(6));
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                if (!firstChunkLogged) {
                  console.log("[completions]    → first token received (%dms)", Date.now() - dispatchStart);
                  firstChunkLogged = true;
                }
                appendChunk(requestId, content);
              }
            }
          } catch { /* ignore parse errors */ }
        },
        flush() {
          console.log("[completions]    → stream closed (%d SSE chunks total)", chunkCount);
        },
      });
      const trackedStream = streamResult.stream.pipeThrough(activityTracker);

      // Log asynchronously after stream completes
      // Capture dispatch info right after the provider call (before async metadata)
      const streamDispatchInfo = getDispatchInfo();
      if (streamDispatchInfo.dispatchMode) {
        logStep(requestId, "warm_pool_dispatch", "completed", JSON.stringify({
          mode: streamDispatchInfo.dispatchMode, model: decision.model, backfill: streamDispatchInfo.backfillCount,
        }));
      }

      // Wrap metadata promise with timeout to prevent stuck requests
      withTimeout(streamResult.metadata, 120_000, `stream-metadata-${requestId}`)
        .then(async (meta) => {
          completeRequest(requestId);
        updateTokens(requestId, meta.tokensIn, meta.tokensOut);
        const dispatchDuration = Date.now() - dispatchStart;
        const totalLatency = Date.now() - requestStart;

        logStep(requestId, "provider_streaming", "completed", JSON.stringify({
          tokensIn: meta.tokensIn, tokensOut: meta.tokensOut, costUsd: meta.costUsd, responseChars: meta.text.length,
        }), dispatchDuration);
        logStep(requestId, "provider_done", "completed", `${dispatchDuration}ms`, dispatchDuration);

        console.log("[completions] ✔ STREAM DONE  latency=%dms cost=$%s tokensIn=%d tokensOut=%d",
          dispatchDuration, meta.costUsd.toFixed(4), meta.tokensIn, meta.tokensOut);
        console.log("════════════════════════════════════════════════════════\n");

        const evalResult = evaluate(meta.text, true, decision.category, decision.complexityScore);

        try {
          await insertTaskLog({
            requestId,
            provider: decision.provider,
            taskCategory: decision.category,
            complexityScore: decision.complexityScore,
            promptSummary,
            messageCount: body.messages.length,
            modelRequested: requestModel,
            modelSelected: decision.model,
            routerReason: decision.reason,
            tokensIn: meta.tokensIn,
            tokensOut: meta.tokensOut,
            costUsd: meta.costUsd.toFixed(6),
            latencyMs: dispatchDuration,
            streaming: true,
            cliSuccess: evalResult.cliSuccess,
            heuristicScore: evalResult.heuristicScore,
            tokensBeforeCompression: compressionResult.tokensBefore,
            tokensAfterCompression: compressionResult.tokensAfter,
            budgetRemainingUsd: budgetResult.remainingUsd === Infinity ? undefined : budgetResult.remainingUsd.toFixed(2),
            responseText: meta.text,
            promptText: lastUserText,
            dispatchMode: streamDispatchInfo.dispatchMode,
          });
          logStep(requestId, "log_task", "completed");
        } catch (err) {
          console.error("[completions] Failed to log task:", err);
          logStep(requestId, "log_task", "error", (err as Error).message);
        }

        logStep(requestId, "response_sent", "completed", `total=${totalLatency}ms`);
        updateRequestStatus(requestId, "completed", { httpStatus: 200, totalLatencyMs: totalLatency }).catch(() => {});
        })
        .catch((err) => {
          completeRequest(requestId);
          console.error("[completions] Stream metadata error:", err);
          logStep(requestId, "provider_streaming", "error", (err as Error).message);
          updateRequestStatus(requestId, "error", { 
            httpStatus: 500, 
            errorMessage: (err as Error).message, 
            totalLatencyMs: Date.now() - requestStart 
          }).catch(() => {});
        });

      const streamHeaders: Record<string, string> = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "x-request-id": requestId,
        "x-task-id": requestId,
        "x-provider": decision.provider,
        "x-model": decision.alias,
        "x-router-reason": decision.reason,
        "x-tokens-saved": String(tokensSaved),
      };
      if (streamDispatchInfo.dispatchMode) {
        streamHeaders["x-dispatch-mode"] = streamDispatchInfo.dispatchMode;
      }

      return new Response(trackedStream, { headers: streamHeaders });
    } catch (err) {
      const errMsg = (err as Error).message;
      const dispatchDuration = Date.now() - dispatchStart;
      logStep(requestId, "provider_dispatch", "error", errMsg, dispatchDuration);
      updateRequestStatus(requestId, "error", { httpStatus: 500, errorMessage: errMsg, totalLatencyMs: Date.now() - requestStart }).catch(() => {});
      return errorResponse(errMsg, "provider_error", 500);
    }
  } else {
    // ── Non-streaming path ──
    logStep(requestId, "provider_dispatch", "started", JSON.stringify({
      provider: decision.provider, model: decision.model, streaming: false,
    }));

    // Register in active requests store for real-time activity page
    registerRequest(requestId, {
      requestId,
      provider: decision.provider,
      model: decision.alias || decision.model,
      category: decision.category,
      promptPreview: promptPreviewText.slice(0, 200),
      tokensIn: 0,
      tokensOut: 0,
    });

    try {
      const result = await provider.complete(providerRequest);

      completeRequest(requestId);

      const nonStreamDispatchInfo = getDispatchInfo();
      if (nonStreamDispatchInfo.dispatchMode) {
        logStep(requestId, "warm_pool_dispatch", "completed", JSON.stringify({
          mode: nonStreamDispatchInfo.dispatchMode, model: decision.model, backfill: nonStreamDispatchInfo.backfillCount,
        }));
      }

      const dispatchDuration = Date.now() - dispatchStart;
      console.log("[completions] ✔ RESPONSE DONE  latency=%dms cost=$%s tokensIn=%d tokensOut=%d chars=%d",
        dispatchDuration, result.costUsd.toFixed(4), result.tokensIn, result.tokensOut, result.text.length);
      logStep(requestId, "provider_done", "completed", JSON.stringify({
        tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd,
        responseChars: result.text.length,
      }), dispatchDuration);

      const latencyMs = Date.now() - requestStart;
      const evalResult = evaluate(result.text, true, decision.category, decision.complexityScore);

      // Log to DB
      let loggedTaskId = requestId;
      try {
        loggedTaskId = await insertTaskLog({
          requestId,
          provider: decision.provider,
          taskCategory: decision.category,
          complexityScore: decision.complexityScore,
          promptSummary,
          messageCount: body.messages.length,
          modelRequested: requestModel,
          modelSelected: decision.model,
          routerReason: decision.reason,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd.toFixed(6),
          latencyMs,
          streaming: false,
          cliSuccess: true,
          heuristicScore: evalResult.heuristicScore,
          tokensBeforeCompression: compressionResult.tokensBefore,
          tokensAfterCompression: compressionResult.tokensAfter,
          budgetRemainingUsd: budgetResult.remainingUsd === Infinity ? undefined : budgetResult.remainingUsd.toFixed(2),
          responseText: result.text,
          promptText: lastUserText,
          dispatchMode: nonStreamDispatchInfo.dispatchMode,
        });
        logStep(requestId, "log_task", "completed");
      } catch (err) {
        console.error("[completions] Failed to log task:", err);
        logStep(requestId, "log_task", "error", (err as Error).message);
      }

      const hasToolCallsInResponse = result.toolCalls && result.toolCalls.length > 0;

      if (hasToolCallsInResponse) {
        logStep(requestId, "tool_parse", "completed", `${result.toolCalls!.length} tool calls`);
      }

      const response: ChatCompletionResponse = {
        id: completionId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: RESPONSE_MODEL,
        choices: [
          {
            index: 0,
            message: hasToolCallsInResponse
              ? { role: "assistant", content: result.text || null, tool_calls: result.toolCalls }
              : { role: "assistant", content: result.text },
            finish_reason: result.finishReason,
          },
        ],
        usage: {
          prompt_tokens: result.tokensIn,
          completion_tokens: result.tokensOut,
          total_tokens: result.tokensIn + result.tokensOut,
        },
      };

      // Cache the successful response
      const cacheKey = getCacheKey(`${decision.provider}:${decision.model}`, null, body.messages);
      setInCache(cacheKey, response);

      logStep(requestId, "response_sent", "completed", `total=${latencyMs}ms`);
      updateRequestStatus(requestId, "completed", { httpStatus: 200, totalLatencyMs: latencyMs }).catch(() => {});
      console.log("════════════════════════════════════════════════════════\n");

      const nonStreamHeaders: Record<string, string> = {
        "x-request-id": requestId,
        "x-task-id": loggedTaskId,
        "x-provider": decision.provider,
        "x-model": decision.alias,
        "x-router-reason": decision.reason,
        "x-tokens-saved": String(tokensSaved),
        "x-cache-hit": "false",
      };
      if (nonStreamDispatchInfo.dispatchMode) {
        nonStreamHeaders["x-dispatch-mode"] = nonStreamDispatchInfo.dispatchMode;
      }

      return NextResponse.json(response, { headers: nonStreamHeaders });
    } catch (err) {
      completeRequest(requestId);
      const errMsg = (err as Error).message;
      const dispatchDuration = Date.now() - dispatchStart;
      logStep(requestId, "provider_dispatch", "error", errMsg, dispatchDuration);

      // Log the failure
      try {
        await insertTaskLog({
          requestId,
          provider: decision.provider,
          taskCategory: decision.category,
          complexityScore: decision.complexityScore,
          promptSummary,
          messageCount: body.messages.length,
          modelRequested: requestModel,
          modelSelected: decision.model,
          routerReason: decision.reason,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: "0",
          latencyMs: Date.now() - requestStart,
          streaming: false,
          cliSuccess: false,
          heuristicScore: 0,
          errorMessage: errMsg.slice(0, 500),
          tokensBeforeCompression: compressionResult.tokensBefore,
          tokensAfterCompression: compressionResult.tokensAfter,
        });
      } catch { /* ignore */ }

      updateRequestStatus(requestId, "error", { httpStatus: 500, errorMessage: errMsg, totalLatencyMs: Date.now() - requestStart }).catch(() => {});
      return errorResponse(errMsg, "provider_error", 500);
    }
  }
}
