import type { ChatCompletionChunk } from "./types";

export interface StreamAccumulator {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export function createStreamTransformer(
  completionId: string,
  model: string,
  onDone: (accumulated: StreamAccumulator) => void
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  const accumulated: StreamAccumulator = { text: "", tokensIn: 0, tokensOut: 0 };
  const created = Math.floor(Date.now() / 1000);

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });

      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const event = JSON.parse(trimmed);
          processEvent(event, completionId, model, created, accumulated, controller, encoder);
        } catch {
          // Not valid JSON, skip
        }
      }
    },

    flush(controller) {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          processEvent(event, completionId, model, created, accumulated, controller, encoder);
        } catch {
          // Ignore
        }
      }

      // Send [DONE]
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      onDone(accumulated);
    },
  });
}

function processEvent(
  event: Record<string, unknown>,
  completionId: string,
  model: string,
  created: number,
  accumulated: StreamAccumulator,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
) {
  const type = event.type as string | undefined;

  if (type === "message_start") {
    const message = event.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, number> | undefined;
    if (usage?.input_tokens) {
      accumulated.tokensIn = usage.input_tokens;
    }

    // Send initial chunk with role
    const chunk: ChatCompletionChunk = {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  } else if (type === "content_block_delta") {
    const delta = event.delta as Record<string, string> | undefined;
    if (delta?.type === "text_delta" && delta.text) {
      accumulated.text += delta.text;

      const chunk: ChatCompletionChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    }
  } else if (type === "message_delta") {
    const usage = event.usage as Record<string, number> | undefined;
    if (usage?.output_tokens) {
      accumulated.tokensOut = usage.output_tokens;
    }

    const chunk: ChatCompletionChunk = {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  }
}
