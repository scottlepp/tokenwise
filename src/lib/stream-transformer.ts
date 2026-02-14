import type { ChatCompletionChunk } from "./types";

export interface StreamAccumulator {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export function createStreamTransformer(
  completionId: string,
  model: string,
  onDone: (accumulated: StreamAccumulator) => void,
  options?: { includeUsage?: boolean }
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  const accumulated: StreamAccumulator = { text: "", tokensIn: 0, tokensOut: 0, costUsd: 0 };
  const created = Math.floor(Date.now() / 1000);
  let sentRole = false;
  let sentStop = false;

  function emit(
    controller: TransformStreamDefaultController<Uint8Array>,
    delta: Record<string, unknown>,
    finishReason: "stop" | "length" | null,
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null,
  ) {
    if (finishReason === "stop" && sentStop) return;
    if (finishReason === "stop") sentStop = true;

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

  function handle(event: Record<string, unknown>, controller: TransformStreamDefaultController<Uint8Array>) {
    const type = event.type as string | undefined;

    // --- Claude CLI stream-json format ---
    // { type: "system", ... }
    // { type: "assistant", message: { content: [{ type: "text", text: "..." }], usage: {...} } }
    // { type: "result", result: "...", usage: {...} }

    if (type === "assistant") {
      const message = event.message as Record<string, unknown> | undefined;
      if (!message) return;

      emitRole(controller);

      const content = message.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") {
            accumulated.text += block.text;
            // Stream in small chunks
            const text = block.text;
            const chunkSize = 20;
            for (let i = 0; i < text.length; i += chunkSize) {
              emit(controller, { content: text.slice(i, i + chunkSize) }, null);
            }
          }
        }
      }

      const usage = message.usage as Record<string, number> | undefined;
      if (usage) {
        accumulated.tokensIn = usage.input_tokens ?? 0;
        accumulated.tokensOut = usage.output_tokens ?? 0;
      }
    } else if (type === "result") {
      // Prefer modelUsage for accurate token counts (includes cache tokens)
      const modelUsage = event.modelUsage as Record<string, Record<string, number>> | undefined;
      if (modelUsage) {
        let tokensIn = 0;
        let tokensOut = 0;
        let costUsd = 0;
        for (const model of Object.values(modelUsage)) {
          tokensIn += (model.inputTokens ?? 0) + (model.cacheReadInputTokens ?? 0) + (model.cacheCreationInputTokens ?? 0);
          tokensOut += model.outputTokens ?? 0;
          costUsd += model.costUSD ?? 0;
        }
        accumulated.tokensIn = tokensIn;
        accumulated.tokensOut = tokensOut;
        accumulated.costUsd = costUsd;
      } else {
        // Fallback to basic usage fields
        const usage = event.usage as Record<string, number> | undefined;
        if (usage) {
          accumulated.tokensIn = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
          accumulated.tokensOut = usage.output_tokens ?? accumulated.tokensOut;
        }
        accumulated.costUsd = (event.total_cost_usd as number) ?? 0;
      }

      // Fallback: if assistant event didn't provide content, use result text
      if (!accumulated.text && typeof event.result === "string") {
        accumulated.text = event.result;
        emitRole(controller);
        emit(controller, { content: event.result }, null);
      }

      const usage = options?.includeUsage !== false ? {
        prompt_tokens: accumulated.tokensIn,
        completion_tokens: accumulated.tokensOut,
        total_tokens: accumulated.tokensIn + accumulated.tokensOut,
      } : undefined;
      emit(controller, {}, "stop", usage);

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
        emit(controller, { content: delta.text }, null);
      }
    } else if (type === "message_delta") {
      const usage = event.usage as Record<string, number> | undefined;
      if (usage?.output_tokens) {
        accumulated.tokensOut = usage.output_tokens;
      }
      emit(controller, {}, "stop");
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

      // Only send [DONE] if we haven't already sent a stop via result event
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      onDone(accumulated);
    },
  });
}
