export interface StreamAccumulator {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * OpenAI SSE is already in the target format.
 * This transformer passes through the data while accumulating token counts and cost.
 */
export function createOpenAIPassthroughTransformer(
  costPerMInput: number,
  costPerMOutput: number,
  onDone: (accumulated: StreamAccumulator) => void,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  const accumulated: StreamAccumulator = { text: "", tokensIn: 0, tokensOut: 0, costUsd: 0 };

  return new TransformStream({
    transform(chunk, controller) {
      // Pass through raw bytes
      controller.enqueue(chunk);

      // Also parse for accumulation
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]") continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
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
        } catch {
          // Skip
        }
      }
    },

    flush(controller) {
      // Process any remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.usage) {
              accumulated.tokensIn = data.usage.prompt_tokens ?? 0;
              accumulated.tokensOut = data.usage.completion_tokens ?? 0;
              accumulated.costUsd = (accumulated.tokensIn * costPerMInput + accumulated.tokensOut * costPerMOutput) / 1_000_000;
            }
          } catch { /* ignore */ }
        }
      }
      onDone(accumulated);
    },
  });
}
