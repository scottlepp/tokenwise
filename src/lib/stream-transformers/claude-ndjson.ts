import type { ChatCompletionChunk } from "../types";
import { parseToolCalls } from "../tool-parser";
import { RESPONSE_MODEL } from "../config";

export interface StreamAccumulator {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

const TOOL_OPEN_TAG = "<tool_call>";
const TOOL_CLOSE_TAG = "</tool_call>";

export function createClaudeNdjsonTransformer(
  completionId: string,
  model: string,
  onDone: (accumulated: StreamAccumulator) => void,
  options?: { includeUsage?: boolean; hasTools?: boolean }
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  const accumulated: StreamAccumulator = { text: "", tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const created = Math.floor(Date.now() / 1000);
  let sentRole = false;
  let sentStop = false;
  let gotResult = false;
  let onDoneCalled = false;

  // Tool call in-stream detection state
  let toolCallMode = false;
  let toolCallBuffer = "";
  let pendingTextBuffer = "";
  let toolCallIndex = 0;

  function emit(
    controller: TransformStreamDefaultController<Uint8Array>,
    delta: Record<string, unknown>,
    finishReason: "stop" | "length" | "tool_calls" | null,
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null,
  ) {
    if ((finishReason === "stop" || finishReason === "tool_calls") && sentStop) return;
    if (finishReason === "stop" || finishReason === "tool_calls") sentStop = true;

    const chunk: ChatCompletionChunk = {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model: RESPONSE_MODEL,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage ? { usage } : {}),
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  }

  function emitRole(controller: TransformStreamDefaultController<Uint8Array>) {
    if (!sentRole) {
      emit(controller, { role: "assistant" }, null);
      sentRole = true;
    }
  }

  let streamedTextLength = 0;

  function streamContentChunks(controller: TransformStreamDefaultController<Uint8Array>, text: string) {
    const chunkSize = 20;
    for (let i = 0; i < text.length; i += chunkSize) {
      emit(controller, { content: text.slice(i, i + chunkSize) }, null);
    }
    streamedTextLength += text.length;
  }

  function streamText(controller: TransformStreamDefaultController<Uint8Array>, text: string) {
    emitRole(controller);
    streamContentChunks(controller, text);
  }

  /** Parse a complete <tool_call>...</tool_call> block and emit as OpenAI tool_calls delta */
  function emitToolCallFromBuffer(controller: TransformStreamDefaultController<Uint8Array>, block: string) {
    const match = block.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
    if (!match) return;

    try {
      const parsed = JSON.parse(match[1]);
      const name = parsed.name;
      const args = parsed.arguments ?? {};
      const argsStr = typeof args === "string" ? args : JSON.stringify(args);
      const callId = `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

      emitRole(controller);

      // Emit tool call name
      emit(controller, {
        tool_calls: [{
          index: toolCallIndex,
          id: callId,
          type: "function" as const,
          function: { name, arguments: "" },
        }],
      }, null);

      // Emit tool call arguments in chunks
      const argChunkSize = 100;
      for (let i = 0; i < argsStr.length; i += argChunkSize) {
        emit(controller, {
          tool_calls: [{
            index: toolCallIndex,
            function: { arguments: argsStr.slice(i, i + argChunkSize) },
          }],
        }, null);
      }

      toolCallIndex++;
    } catch {
      // Malformed tool call JSON — emit as regular text
      console.warn("[claude-ndjson] Failed to parse tool call, emitting as text");
      emitRole(controller);
      streamContentChunks(controller, block);
    }
  }

  /** Stream text with in-stream <tool_call> detection when hasTools is true */
  function streamTextToolAware(controller: TransformStreamDefaultController<Uint8Array>, text: string) {
    pendingTextBuffer += text;

    while (pendingTextBuffer.length > 0) {
      if (toolCallMode) {
        // Inside a <tool_call> block — accumulate into toolCallBuffer
        const closeIdx = pendingTextBuffer.indexOf(TOOL_CLOSE_TAG);
        if (closeIdx === -1) {
          // No closing tag yet — buffer everything
          toolCallBuffer += pendingTextBuffer;
          pendingTextBuffer = "";
        } else {
          // Found closing tag — extract the complete tool call
          const endOfClose = closeIdx + TOOL_CLOSE_TAG.length;
          toolCallBuffer += pendingTextBuffer.slice(0, endOfClose);
          pendingTextBuffer = pendingTextBuffer.slice(endOfClose);
          toolCallMode = false;

          // Parse and emit the tool call
          emitToolCallFromBuffer(controller, toolCallBuffer);
          toolCallBuffer = "";
        }
      } else {
        // Normal text mode — look for <tool_call> opening
        const openIdx = pendingTextBuffer.indexOf(TOOL_OPEN_TAG);
        if (openIdx === -1) {
          // No tool call tag found. Hold back the last (TOOL_OPEN_TAG.length - 1)
          // characters in case they're the start of a partial tag across chunks.
          const safeLen = pendingTextBuffer.length - (TOOL_OPEN_TAG.length - 1);
          if (safeLen > 0) {
            const safe = pendingTextBuffer.slice(0, safeLen);
            pendingTextBuffer = pendingTextBuffer.slice(safeLen);
            emitRole(controller);
            streamContentChunks(controller, safe);
          }
          break; // Wait for more data
        } else {
          // Found <tool_call> — emit any text before it, then enter tool call mode
          if (openIdx > 0) {
            const before = pendingTextBuffer.slice(0, openIdx);
            emitRole(controller);
            streamContentChunks(controller, before);
          }
          toolCallMode = true;
          toolCallBuffer = TOOL_OPEN_TAG;
          pendingTextBuffer = pendingTextBuffer.slice(openIdx + TOOL_OPEN_TAG.length);
        }
      }
    }
  }

  function handleText(controller: TransformStreamDefaultController<Uint8Array>, text: string) {
    accumulated.text += text;
    if (options?.hasTools) {
      streamTextToolAware(controller, text);
    } else {
      streamText(controller, text);
    }
  }

  function handle(event: Record<string, unknown>, controller: TransformStreamDefaultController<Uint8Array>) {
    const type = event.type as string | undefined;

    if (type === "assistant") {
      const message = event.message as Record<string, unknown> | undefined;
      if (!message) return;

      emitRole(controller);

      const content = message.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            handleText(controller, block.text);
          }
        }
      }

      const usage = message.usage as Record<string, number> | undefined;
      if (usage) {
        accumulated.tokensIn = usage.input_tokens ?? 0;
        accumulated.tokensOut = usage.output_tokens ?? 0;
      }
    } else if (type === "result") {
      gotResult = true;
      const modelUsage = event.modelUsage as Record<string, Record<string, number>> | undefined;
      if (modelUsage) {
        let tokensIn = 0;
        let tokensOut = 0;
        let costUsd = 0;
        for (const m of Object.values(modelUsage)) {
          tokensIn += (m.inputTokens ?? 0) + (m.cacheReadInputTokens ?? 0) + (m.cacheCreationInputTokens ?? 0);
          tokensOut += m.outputTokens ?? 0;
          costUsd += m.costUSD ?? 0;
        }
        accumulated.tokensIn = tokensIn;
        accumulated.tokensOut = tokensOut;
        accumulated.costUsd = costUsd;
      } else {
        const usage = event.usage as Record<string, number> | undefined;
        if (usage) {
          accumulated.tokensIn = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
          accumulated.tokensOut = usage.output_tokens ?? accumulated.tokensOut;
        }
        accumulated.costUsd = (event.total_cost_usd as number) ?? 0;
      }

      if (!accumulated.text && typeof event.result === "string") {
        handleText(controller, event.result);
      }

      if (!options?.hasTools) {
        const usage = options?.includeUsage !== false ? {
          prompt_tokens: accumulated.tokensIn,
          completion_tokens: accumulated.tokensOut,
          total_tokens: accumulated.tokensIn + accumulated.tokensOut,
        } : undefined;
        emit(controller, {}, "stop", usage);
        // Resolve metadata immediately on the result event — don't wait for
        // flush(), which may be blocked by downstream back-pressure or a
        // client disconnect that stalls the pipeline.
        callOnDone();
      }

    // --- Raw Anthropic API format (compatibility) ---
    } else if (type === "message_start") {
      const message = event.message as Record<string, unknown> | undefined;
      const usage = message?.usage as Record<string, number> | undefined;
      if (usage?.input_tokens) {
        accumulated.tokensIn = usage.input_tokens;
      }
      emitRole(controller);
    } else if (type === "content_block_delta") {
      const delta = event.delta as Record<string, string> | undefined;
      if (delta?.type === "text_delta" && delta.text) {
        handleText(controller, delta.text);
      }
    } else if (type === "message_delta") {
      const usage = event.usage as Record<string, number> | undefined;
      if (usage?.output_tokens) {
        accumulated.tokensOut = usage.output_tokens;
      }
      if (!options?.hasTools) {
        emit(controller, {}, "stop");
      }
    }
  }


  function callOnDone() {
    if (onDoneCalled) return;
    onDoneCalled = true;
    try {
      // Strip tool call XML from accumulated text for clean logging
      if (options?.hasTools && toolCallIndex > 0) {
        const parsed = parseToolCalls(accumulated.text);
        accumulated.text = parsed.textContent ?? "";
      }
      onDone(accumulated);
    } catch (err) {
      console.error("[claude-ndjson] Error in onDone callback:", err);
    }
  }

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          handle(JSON.parse(trimmed), controller);
        } catch {
          // Not valid JSON, skip
        }
      }
    },

    flush(controller) {
      if (buffer.trim()) {
        try {
          handle(JSON.parse(buffer.trim()), controller);
        } catch {
          // Ignore
        }
      }

      // Flush any pending tool-aware buffers
      if (options?.hasTools) {
        if (toolCallMode && toolCallBuffer) {
          // Incomplete tool call at end of stream — try to parse it anyway
          const withClose = toolCallBuffer.includes(TOOL_CLOSE_TAG)
            ? toolCallBuffer
            : toolCallBuffer + TOOL_CLOSE_TAG;
          emitToolCallFromBuffer(controller, withClose);
          toolCallBuffer = "";
          toolCallMode = false;
        }
        if (pendingTextBuffer) {
          // Remaining held-back text — emit it
          emitRole(controller);
          streamContentChunks(controller, pendingTextBuffer);
          pendingTextBuffer = "";
        }

        // Safety fallback: if no tool calls were emitted in-stream, re-check accumulated text
        if (toolCallIndex === 0 && accumulated.text) {
          const parsed = parseToolCalls(accumulated.text);
          if (parsed.toolCalls.length > 0) {
            for (let i = 0; i < parsed.toolCalls.length; i++) {
              const tc = parsed.toolCalls[i];
              emit(controller, {
                tool_calls: [{
                  index: i,
                  id: tc.id,
                  type: "function" as const,
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                  },
                }],
              }, null);
            }
            toolCallIndex = parsed.toolCalls.length;
          }
        }

        const finishReason = toolCallIndex > 0 ? "tool_calls" : "stop";
        const usage = options?.includeUsage !== false ? {
          prompt_tokens: accumulated.tokensIn,
          completion_tokens: accumulated.tokensOut,
          total_tokens: accumulated.tokensIn + accumulated.tokensOut,
        } : undefined;
        emit(controller, {}, finishReason, usage);
      } else if (!sentStop && gotResult) {
        const usage = options?.includeUsage !== false ? {
          prompt_tokens: accumulated.tokensIn,
          completion_tokens: accumulated.tokensOut,
          total_tokens: accumulated.tokensIn + accumulated.tokensOut,
        } : undefined;
        emit(controller, {}, "stop", usage);
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));

      // Always call onDone to ensure metadata promise resolves
      callOnDone();
    },
  });
}
