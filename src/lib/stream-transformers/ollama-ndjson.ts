import type { ChatCompletionChunk } from "../types";
import { RESPONSE_MODEL } from "../config";

export interface StreamAccumulator {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Transform Ollama NDJSON streaming format into OpenAI SSE format.
 * Ollama streams JSON lines with message.content field.
 */
export function createOllamaNdjsonTransformer(
  completionId: string,
  model: string,
  onDone: (accumulated: StreamAccumulator) => void,
  options?: { includeUsage?: boolean }
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  const accumulated: StreamAccumulator = { text: "", tokensIn: 0, tokensOut: 0, costUsd: 0 };
  let onDoneCalled = false;
  const created = Math.floor(Date.now() / 1000);
  let sentRole = false;

  function emit(
    controller: TransformStreamDefaultController<Uint8Array>,
    delta: Record<string, unknown>,
    finishReason: "stop" | "length" | null,
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null,
  ) {
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

  function handleLine(data: Record<string, unknown>, controller: TransformStreamDefaultController<Uint8Array>) {
    if (!sentRole) {
      emit(controller, { role: "assistant" }, null);
      sentRole = true;
    }

    const message = data.message as Record<string, string> | undefined;
    if (message?.content) {
      accumulated.text += message.content;
      emit(controller, { content: message.content }, null);
    }

    // Ollama signals completion with done: true
    if (data.done === true) {
      accumulated.tokensIn = (data.prompt_eval_count as number) ?? 0;
      accumulated.tokensOut = (data.eval_count as number) ?? 0;
      // Ollama is local, cost is $0
      accumulated.costUsd = 0;

      const usageObj = options?.includeUsage !== false ? {
        prompt_tokens: accumulated.tokensIn,
        completion_tokens: accumulated.tokensOut,
        total_tokens: accumulated.tokensIn + accumulated.tokensOut,
      } : undefined;
      emit(controller, {}, "stop", usageObj);
    }
  }


  function callOnDone() {
    if (onDoneCalled) return;
    onDoneCalled = true;
    try {
      callOnDone();
    } catch (err) {
      console.error("[stream-transformer] Error in onDone callback:", err);
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
          handleLine(JSON.parse(trimmed), controller);
        } catch {
          // Skip
        }
      }
    },

    flush(controller) {
      if (buffer.trim()) {
        try {
          handleLine(JSON.parse(buffer.trim()), controller);
        } catch { /* ignore */ }
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      callOnDone();
    },
  });
}
