import type { ChatCompletionChunk } from "../types";
import { RESPONSE_MODEL } from "../config";

export interface StreamAccumulator {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Transform Gemini SSE events into OpenAI SSE format.
 * Gemini streaming returns JSON objects with candidates[0].content.parts[0].text
 */
export function createGeminiSseTransformer(
  completionId: string,
  model: string,
  costPerMInput: number,
  costPerMOutput: number,
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

  function handleChunk(data: Record<string, unknown>, controller: TransformStreamDefaultController<Uint8Array>) {
    if (!sentRole) {
      emit(controller, { role: "assistant" }, null);
      sentRole = true;
    }

    // Extract text from candidates[0].content.parts[0].text
    const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
    if (candidates?.[0]) {
      const content = candidates[0].content as Record<string, unknown> | undefined;
      const parts = content?.parts as Array<Record<string, string>> | undefined;
      if (parts?.[0]?.text) {
        accumulated.text += parts[0].text;
        emit(controller, { content: parts[0].text }, null);
      }

      // Check finish reason
      const finishReason = candidates[0].finishReason as string | undefined;
      if (finishReason === "STOP" || finishReason === "MAX_TOKENS") {
        // Extract usage metadata
        const usageMetadata = data.usageMetadata as Record<string, number> | undefined;
        if (usageMetadata) {
          accumulated.tokensIn = usageMetadata.promptTokenCount ?? 0;
          accumulated.tokensOut = usageMetadata.candidatesTokenCount ?? 0;
          accumulated.costUsd = (accumulated.tokensIn * costPerMInput + accumulated.tokensOut * costPerMOutput) / 1_000_000;
        }

        const usageObj = options?.includeUsage !== false ? {
          prompt_tokens: accumulated.tokensIn,
          completion_tokens: accumulated.tokensOut,
          total_tokens: accumulated.tokensIn + accumulated.tokensOut,
        } : undefined;
        emit(controller, {}, finishReason === "STOP" ? "stop" : "length", usageObj);
      }
    }

    // Usage may come without finish on intermediate chunks
    const usageMetadata = data.usageMetadata as Record<string, number> | undefined;
    if (usageMetadata) {
      accumulated.tokensIn = usageMetadata.promptTokenCount ?? accumulated.tokensIn;
      accumulated.tokensOut = usageMetadata.candidatesTokenCount ?? accumulated.tokensOut;
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

      // Gemini SSE: "data: <json>\n\n"
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const dataStr = trimmed.slice(6);
        if (!dataStr) continue;

        try {
          handleChunk(JSON.parse(dataStr), controller);
        } catch {
          // Skip malformed
        }
      }
    },

    flush(controller) {
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data: ")) {
          try {
            handleChunk(JSON.parse(trimmed.slice(6)), controller);
          } catch { /* ignore */ }
        }
      }

      accumulated.costUsd = (accumulated.tokensIn * costPerMInput + accumulated.tokensOut * costPerMOutput) / 1_000_000;
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      callOnDone();
    },
  });
}
