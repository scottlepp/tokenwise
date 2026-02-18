import { NextRequest, NextResponse } from "next/server";
import { convertMessages } from "@/lib/message-converter";
import { spawnClaudeNonStreaming, spawnClaudeStreaming } from "@/lib/claude-cli";
import { createStreamTransformer } from "@/lib/stream-transformer";
import { selectModel } from "@/lib/router";
import { evaluate } from "@/lib/success-evaluator";
import { modelAlias } from "@/lib/config";
import { insertTaskLog, updateUserRating, getMostRecentTaskId, findTaskByPartialId } from "@/lib/db/queries";
import { getCacheKey, getDedupKey, getFromCache, setInCache, isDuplicate, markDedup } from "@/lib/cache";
import { compress } from "@/lib/compressor";
import { checkBudget, downgradeModel } from "@/lib/budget";
import { parseToolCalls } from "@/lib/tool-parser";
import type { ChatCompletionRequest, ChatCompletionResponse, ClaudeModel } from "@/lib/types";

// Always report this model in responses — keeps clients like Cline happy
// regardless of which model actually handled the request
const RESPONSE_MODEL = "claude-sonnet-4-5-20250929";

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
  console.log("[completions] Incoming request from", request.headers.get("user-agent"));

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

  // 1. Check for /feedback command
  const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user");
  if (lastUserMsg) {
    const text = typeof lastUserMsg.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg.content)
        ? lastUserMsg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")
        : "";
    const feedback = parseFeedbackCommand(text.trim());
    if (feedback) {
      return handleFeedback(feedback.rating, feedback.taskId, RESPONSE_MODEL);
    }
  }

  // 2. Check dedup window (catches Cursor duplicate sends)
  const lastUserText = lastUserMsg
    ? typeof lastUserMsg.content === "string"
      ? lastUserMsg.content
      : Array.isArray(lastUserMsg.content)
        ? lastUserMsg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")
        : ""
    : "";
  const dedupKey = getDedupKey(lastUserText);
  if (isDuplicate(dedupKey) && !streaming) {
    // Return a simple acknowledgment for duplicate requests
    return errorResponse("Duplicate request detected, please wait", "duplicate_request", 429);
  }
  markDedup(dedupKey);

  // 3. Route to model
  console.log("[completions] prompt preview: %s", lastUserText.slice(0, 200));
  let decision, category, complexityScore;
  try {
    const result = await selectModel(requestModel, body.messages);
    decision = result.decision;
    category = result.category;
    complexityScore = result.complexityScore;
  } catch {
    const { classifyTask } = await import("@/lib/task-classifier");
    const classification = classifyTask(body.messages);
    category = classification.category;
    complexityScore = classification.complexityScore;
    decision = {
      model: "claude-sonnet-4-5-20250929" as ClaudeModel,
      alias: "sonnet",
      reason: "Router error, defaulting to sonnet",
    };
  }

  // 3.5. Enforce minimum model for agentic clients (Cline, Aider, etc.)
  const userAgent = request.headers.get("user-agent") ?? "";
  const isAgenticClient = /cline|aider|continue|copilot/i.test(userAgent);
  if (isAgenticClient && decision.model === "claude-haiku-4-5-20251001") {
    console.log("[completions] upgrading from haiku to sonnet for agentic client: %s", userAgent.slice(0, 50));
    decision = {
      model: "claude-sonnet-4-5-20250929" as ClaudeModel,
      alias: "sonnet",
      reason: `${decision.reason} -> upgraded to sonnet (agentic client)`,
    };
  }

  // 4. Budget check
  const budgetResult = await checkBudget();
  if (!budgetResult.allowed) {
    return errorResponse(budgetResult.reason, "budget_exceeded", 429);
  }
  if (budgetResult.downgrade) {
    const downgraded = downgradeModel(decision.model) as ClaudeModel;
    decision = {
      ...decision,
      model: downgraded,
      alias: modelAlias(downgraded),
      reason: `${decision.reason} -> downgraded due to budget (${budgetResult.reason})`,
    };
  }

  // 5. Check cache (non-streaming only)
  if (!streaming) {
    const { systemPrompt } = convertMessages(body.messages);
    const cacheKey = getCacheKey(decision.model, systemPrompt, body.messages);
    const cached = getFromCache(cacheKey);
    if (cached) {
      // Log cache hit
      try {
        await insertTaskLog({
          taskCategory: category,
          complexityScore,
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

      return NextResponse.json(cached, {
        headers: {
          "x-cache-hit": "true",
          "x-model": decision.alias,
        },
      });
    }
  }

  // 6. Compress messages
  const compressionResult = compress(body.messages);
  const { systemPrompt, prompt, hasTools } = convertMessages(compressionResult.messages, body.tools);
  const tokensSaved = compressionResult.tokensBefore - compressionResult.tokensAfter;

  console.log("[completions] routed to %s (%s) | model=%s | category=%s complexity=%d | tokens: %d→%d (saved %d) | prompt=%d chars",
    decision.alias, decision.reason, decision.model, category, complexityScore,
    compressionResult.tokensBefore, compressionResult.tokensAfter, tokensSaved,
    prompt.length);

  const startTime = Date.now();
  const completionId = `chatcmpl-${crypto.randomUUID()}`;
  const taskId = crypto.randomUUID();
  const promptSummary = prompt.slice(0, 500);

  if (streaming) {
    // Streaming path
    const handle = spawnClaudeStreaming({
      model: decision.model,
      prompt,
      systemPrompt,
      streaming: true,
    });

    let streamClosed = false;
    const nodeToWeb = new ReadableStream<Uint8Array>({
      start(controller) {
        handle.stdout.on("data", (chunk: Buffer) => {
          if (!streamClosed) {
            controller.enqueue(new Uint8Array(chunk));
          }
        });
        handle.stdout.on("end", () => {
          if (!streamClosed) {
            streamClosed = true;
            controller.close();
          }
        });
        handle.stdout.on("error", (err) => {
          if (!streamClosed) {
            streamClosed = true;
            controller.error(err);
          }
        });
      },
      cancel() {
        streamClosed = true;
        handle.child.kill();
      },
    });

    let resolveAccumulated: (value: { text: string; tokensIn: number; tokensOut: number; costUsd: number }) => void;
    const accumulatedPromise = new Promise<{ text: string; tokensIn: number; tokensOut: number; costUsd: number }>((resolve) => {
      resolveAccumulated = resolve;
    });

    const transformer = createStreamTransformer(completionId, RESPONSE_MODEL, (acc) => {
      resolveAccumulated!(acc);
    }, { includeUsage: body.stream_options?.include_usage !== false, hasTools });

    const outputStream = nodeToWeb.pipeThrough(transformer);

    // Log asynchronously after stream completes
    accumulatedPromise.then(async (acc) => {
      const latencyMs = Date.now() - startTime;
      console.log("[completions] stream done in %dms | tokensIn=%d tokensOut=%d cost=$%s | response=%d chars",
        latencyMs, acc.tokensIn, acc.tokensOut, acc.costUsd.toFixed(4), acc.text.length);
      const evalResult = evaluate(acc.text, true, category, complexityScore);

      try {
        await insertTaskLog({
          taskCategory: category,
          complexityScore,
          promptSummary,
          messageCount: body.messages.length,
          modelRequested: requestModel,
          modelSelected: decision.model,
          routerReason: decision.reason,
          tokensIn: acc.tokensIn,
          tokensOut: acc.tokensOut,
          costUsd: acc.costUsd.toFixed(6),
          latencyMs,
          streaming: true,
          cliSuccess: evalResult.cliSuccess,
          heuristicScore: evalResult.heuristicScore,
          tokensBeforeCompression: compressionResult.tokensBefore,
          tokensAfterCompression: compressionResult.tokensAfter,
          budgetRemainingUsd: budgetResult.remainingUsd === Infinity ? undefined : budgetResult.remainingUsd.toFixed(2),
        });
      } catch (err) {
        console.error("[completions] Failed to log task:", err);
      }
    });

    return new Response(outputStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-task-id": taskId,
        "x-model": decision.alias,
        "x-router-reason": decision.reason,
        "x-tokens-saved": String(tokensSaved),
      },
    });
  } else {
    // Non-streaming path
    const result = await spawnClaudeNonStreaming({
      model: decision.model,
      prompt,
      systemPrompt,
      streaming: false,
    });

    const latencyMs = Date.now() - startTime;
    const evalResult = evaluate(result.text, !result.isError, category, complexityScore);

    // Log to DB
    let loggedTaskId = taskId;
    try {
      loggedTaskId = await insertTaskLog({
        taskCategory: category,
        complexityScore,
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
        cliSuccess: !result.isError,
        heuristicScore: evalResult.heuristicScore,
        errorMessage: result.errorMessage,
        tokensBeforeCompression: compressionResult.tokensBefore,
        tokensAfterCompression: compressionResult.tokensAfter,
        budgetRemainingUsd: budgetResult.remainingUsd === Infinity ? undefined : budgetResult.remainingUsd.toFixed(2),
      });
    } catch (err) {
      console.error("[completions] Failed to log task:", err);
    }

    if (result.isError) {
      return errorResponse(
        result.errorMessage ?? "Claude CLI error",
        "cli_error",
        500
      );
    }

    // Parse tool calls from response if tools were provided
    const parsed = hasTools ? parseToolCalls(result.text) : null;
    const hasToolCallsInResponse = parsed && parsed.toolCalls.length > 0;

    const response: ChatCompletionResponse = {
      id: completionId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: RESPONSE_MODEL,
      choices: [
        {
          index: 0,
          message: hasToolCallsInResponse
            ? { role: "assistant", content: parsed!.textContent, tool_calls: parsed!.toolCalls }
            : { role: "assistant", content: result.text },
          finish_reason: hasToolCallsInResponse ? "tool_calls" : "stop",
        },
      ],
      usage: {
        prompt_tokens: result.tokensIn,
        completion_tokens: result.tokensOut,
        total_tokens: result.tokensIn + result.tokensOut,
      },
    };

    if (hasToolCallsInResponse) {
      console.log("[completions] tool_calls detected: %d calls", parsed!.toolCalls.length);
    }

    // Cache the successful response (skip if tool calls — not cacheable)
    const { systemPrompt: sp } = convertMessages(body.messages);
    const cacheKey = getCacheKey(decision.model, sp, body.messages);
    setInCache(cacheKey, response);

    return NextResponse.json(response, {
      headers: {
        "x-task-id": loggedTaskId,
        "x-model": decision.alias,
        "x-router-reason": decision.reason,
        "x-tokens-saved": String(tokensSaved),
        "x-cache-hit": "false",
      },
    });
  }
}
