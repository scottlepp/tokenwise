import { NextRequest, NextResponse } from "next/server";
import { selectModel } from "@/lib/router";
import { evaluate } from "@/lib/success-evaluator";
import { modelAlias } from "@/lib/config";
import {
  insertTaskLog, insertRequestLog, insertStatusLog, updateRequestStatus,
  updateUserRating, getMostRecentTaskId, findTaskByPartialId,
} from "@/lib/db/queries";
import { getCacheKey, getDedupKey, getFromCache, setInCache, isDuplicate, markDedup } from "@/lib/cache";
import { compress } from "@/lib/compressor";
import { checkBudget, downgradeModel } from "@/lib/budget";
import { providerRegistry, initializeProviders } from "@/lib/providers";
import type { ChatCompletionRequest, ChatCompletionResponse, PipelineStep } from "@/lib/types";

// Always report this model in responses — keeps clients like Cline happy
const RESPONSE_MODEL = "claude-sonnet-4-5-20250929";

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
  console.log("[completions] Incoming request from", userAgent);

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
  const toolChoice = body.tool_choice ?? "none";
  console.log("[completions] model=%s stream=%s messages=%d tools=%d tool_choice=%s",
    body.model, body.stream, body.messages?.length ?? 0, toolCount, JSON.stringify(toolChoice));

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return errorResponse("messages array is required and must not be empty", "invalid_messages", 400);
  }

  const requestModel = body.model ?? "auto";
  const streaming = body.stream === true;

  // Extract last user message text (used in multiple places)
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
  const lastUserText = lastUserMsg
    ? typeof lastUserMsg.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg.content)
        ? lastUserMsg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")
        : ""
    : "";

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
  console.log("[completions] prompt preview: %s", lastUserText.slice(0, 200));
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
  const isAgenticClient = /cline|aider|continue|copilot/i.test(userAgent);
  if (isAgenticClient && decision.model === "claude-haiku-4-5-20251001") {
    console.log("[completions] upgrading from haiku to sonnet for agentic client: %s", userAgent.slice(0, 50));
    decision = {
      ...decision,
      model: "claude-sonnet-4-5-20250929",
      alias: "sonnet",
      reason: `${decision.reason} -> upgraded to sonnet (agentic client)`,
    };
    logStep(requestId, "route", "completed", "upgraded haiku->sonnet (agentic client)");
  }

  // ── 4. Budget check ──
  const budgetStart = Date.now();
  const budgetResult = await checkBudget();
  if (!budgetResult.allowed) {
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
  }
  logStep(requestId, "budget_check", "completed", JSON.stringify({
    allowed: true, downgrade: budgetResult.downgrade, remainingUsd: budgetResult.remainingUsd,
  }), Date.now() - budgetStart);

  // ── 5. Check cache (non-streaming only) ──
  if (!streaming) {
    const cacheStart = Date.now();
    const cacheKey = getCacheKey(`${decision.provider}:${decision.model}`, null, body.messages);
    const cached = getFromCache(cacheKey);
    if (cached) {
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
    logStep(requestId, "cache_check", "completed", "cache miss", Date.now() - cacheStart);
  }

  // ── 6. Compress messages ──
  const compressStart = Date.now();
  const compressionResult = compress(body.messages);
  const tokensSaved = compressionResult.tokensBefore - compressionResult.tokensAfter;
  logStep(requestId, "compress", "completed", JSON.stringify({
    tokensBefore: compressionResult.tokensBefore,
    tokensAfter: compressionResult.tokensAfter,
    saved: tokensSaved,
  }), Date.now() - compressStart);

  console.log("[completions] routed to %s/%s (%s) | category=%s complexity=%d | tokens: %d->%d (saved %d)",
    decision.provider, decision.model, decision.reason,
    decision.category, decision.complexityScore,
    compressionResult.tokensBefore, compressionResult.tokensAfter, tokensSaved);

  // ── 7. Get provider and dispatch ──
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
    temperature: body.temperature,
    maxTokens: body.max_tokens,
    stream: streaming,
  };

  if (streaming) {
    // ── Streaming path ──
    logStep(requestId, "provider_dispatch", "started", JSON.stringify({
      provider: decision.provider, model: decision.model, streaming: true,
    }));

    try {
      const streamResult = await provider.stream(providerRequest);

      logStep(requestId, "provider_streaming", "started");

      // Log asynchronously after stream completes
      streamResult.metadata.then(async (meta) => {
        const dispatchDuration = Date.now() - dispatchStart;
        const totalLatency = Date.now() - requestStart;

        logStep(requestId, "provider_streaming", "completed", JSON.stringify({
          tokensIn: meta.tokensIn, tokensOut: meta.tokensOut, costUsd: meta.costUsd, responseChars: meta.text.length,
        }), dispatchDuration);
        logStep(requestId, "provider_done", "completed", `${dispatchDuration}ms`, dispatchDuration);

        console.log("[completions] stream done in %dms | provider=%s | tokensIn=%d tokensOut=%d cost=$%s | response=%d chars",
          dispatchDuration, decision.provider, meta.tokensIn, meta.tokensOut, meta.costUsd.toFixed(4), meta.text.length);

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
          });
          logStep(requestId, "log_task", "completed");
        } catch (err) {
          console.error("[completions] Failed to log task:", err);
          logStep(requestId, "log_task", "error", (err as Error).message);
        }

        logStep(requestId, "response_sent", "completed", `total=${totalLatency}ms`);
        updateRequestStatus(requestId, "completed", { httpStatus: 200, totalLatencyMs: totalLatency }).catch(() => {});
      });

      return new Response(streamResult.stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "x-request-id": requestId,
          "x-task-id": requestId,
          "x-provider": decision.provider,
          "x-model": decision.alias,
          "x-router-reason": decision.reason,
          "x-tokens-saved": String(tokensSaved),
        },
      });
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

    try {
      const result = await provider.complete(providerRequest);

      const dispatchDuration = Date.now() - dispatchStart;
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

      return NextResponse.json(response, {
        headers: {
          "x-request-id": requestId,
          "x-task-id": loggedTaskId,
          "x-provider": decision.provider,
          "x-model": decision.alias,
          "x-router-reason": decision.reason,
          "x-tokens-saved": String(tokensSaved),
          "x-cache-hit": "false",
        },
      });
    } catch (err) {
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
