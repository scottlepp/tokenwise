import { RESPONSE_MODEL } from "../config";

export interface StreamAccumulator {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * OpenAI SSE passthrough with model name rewrite.
 * Parses each SSE chunk, overrides the model field to RESPONSE_MODEL,
 * and re-serializes. Accumulates token counts and cost for logging.
 */
export function createOpenAIPassthroughTransformer(
  costPerMInput: number,
  costPerMOutput: number,
  onDone: (accumulated: StreamAccumulator) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  const accumulated: StreamAccumulator = { text: "", tokensIn: 0, tokensOut: 0, costUsd: 0 };
  let onDoneCalled = false;

  function processLine(line: string, controller: TransformStreamDefaultController<Uint8Array>) {
    const trimmed = line.trim();
    if (!trimmed) {
      controller.enqueue(encoder.encode("\n"));
      return;
    }
    if (trimmed === "data: [DONE]") {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      return;
    }
    if (!trimmed.startsWith("data: ")) {
      controller.enqueue(encoder.encode(trimmed + "\n"));
      return;
    }

    try {
      const data = JSON.parse(trimmed.slice(6));

      // Accumulate text
      const delta = data.choices?.[0]?.delta;
      if (delta?.content) {
        accumulated.text += delta.content;
      }

      // Extract usage from the final chunk
      if (data.usage) {
        accumulated.tokensIn = data.usage.prompt_tokens ?? 0;
        accumulated.tokensOut = data.usage.completion_tokens ?? 0;
        accumulated.costUsd = (accumulated.tokensIn * costPerMInput + accumulated.tokensOut * costPerMOutput) / 1_000_000;
      }

      // Override model name
      data.model = RESPONSE_MODEL;

      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      // Can't parse — pass through as-is
      controller.enqueue(encoder.encode(trimmed + "\n"));
    }
  }


  function callOnDone() {
    if (onDoneCalled) return;
    onDoneCalled = true;
    try {
      onDone(accumulated);
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
        processLine(line, controller);
      }
    },

    flush(controller) {
      if (buffer.trim()) {
        processLine(buffer, controller);
      }
      callOnDone();
    },
  });
}
