import type { ChatCompletionChunk } from "../types";
import { parseToolCalls } from "../tool-parser";

export interface StreamAccumulator {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

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
      model,
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

  function streamText(controller: TransformStreamDefaultController<Uint8Array>, text: string) {
    emitRole(controller);
    const chunkSize = 20;
    for (let i = 0; i < text.length; i += chunkSize) {
      emit(controller, { content: text.slice(i, i + chunkSize) }, null);
    }
    streamedTextLength += text.length;
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
            accumulated.text += block.text;
            streamText(controller, block.text);
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
        accumulated.text = event.result;
        streamText(controller, event.result);
      }

      if (!options?.hasTools) {
        const usage = options?.includeUsage !== false ? {
          prompt_tokens: accumulated.tokensIn,
          completion_tokens: accumulated.tokensOut,
          total_tokens: accumulated.tokensIn + accumulated.tokensOut,
        } : undefined;
        emit(controller, {}, "stop", usage);
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
        accumulated.text += delta.text;
        streamText(controller, delta.text);
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

      if (options?.hasTools && accumulated.text) {
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

          const usage = options?.includeUsage !== false ? {
            prompt_tokens: accumulated.tokensIn,
            completion_tokens: accumulated.tokensOut,
            total_tokens: accumulated.tokensIn + accumulated.tokensOut,
          } : undefined;
          emit(controller, {}, "tool_calls", usage);
        } else {
          const usage = options?.includeUsage !== false ? {
            prompt_tokens: accumulated.tokensIn,
            completion_tokens: accumulated.tokensOut,
            total_tokens: accumulated.tokensIn + accumulated.tokensOut,
          } : undefined;
          emit(controller, {}, "stop", usage);
        }
      } else if (options?.hasTools && gotResult) {
        const usage = options?.includeUsage !== false ? {
          prompt_tokens: accumulated.tokensIn,
          completion_tokens: accumulated.tokensOut,
          total_tokens: accumulated.tokensIn + accumulated.tokensOut,
        } : undefined;
        emit(controller, {}, "stop", usage);
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      onDone(accumulated);
    },
  });
}
