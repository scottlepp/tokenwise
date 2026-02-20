import type { ChatCompletionChunk } from "../types";
import { RESPONSE_MODEL } from "../config";

export interface StreamAccumulator {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * Transform Anthropic API SSE events into OpenAI SSE format.
 * Anthropic SSE uses: message_start, content_block_start, content_block_delta, message_delta, message_stop
 */
export function createAnthropicSseTransformer(
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
  let sentStop = false;

  function emit(
    controller: TransformStreamDefaultController<Uint8Array>,
    delta: Record<string, unknown>,
    finishReason: "stop" | "length" | "tool_calls" | null,
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null,
  ) {
    if (finishReason && sentStop) return;
    if (finishReason) sentStop = true;

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

  function handleEvent(eventType: string, data: Record<string, unknown>, controller: TransformStreamDefaultController<Uint8Array>) {
    if (eventType === "message_start") {
      const message = data.message as Record<string, unknown> | undefined;
      const usage = message?.usage as Record<string, number> | undefined;
      if (usage?.input_tokens) {
        accumulated.tokensIn = usage.input_tokens;
      }
      if (!sentRole) {
        emit(controller, { role: "assistant" }, null);
        sentRole = true;
      }
    } else if (eventType === "content_block_delta") {
      const delta = data.delta as Record<string, string> | undefined;
      if (delta?.type === "text_delta" && delta.text) {
        accumulated.text += delta.text;
        emit(controller, { content: delta.text }, null);
      }
    } else if (eventType === "message_delta") {
      const usage = data.usage as Record<string, number> | undefined;
      if (usage?.output_tokens) {
        accumulated.tokensOut = usage.output_tokens;
      }
      const stopReason = (data.delta as Record<string, string>)?.stop_reason;
      const finishReason = stopReason === "end_turn" ? "stop" : stopReason === "max_tokens" ? "length" : "stop";

      accumulated.costUsd = (accumulated.tokensIn * costPerMInput + accumulated.tokensOut * costPerMOutput) / 1_000_000;

      const usageObj = options?.includeUsage !== false ? {
        prompt_tokens: accumulated.tokensIn,
        completion_tokens: accumulated.tokensOut,
        total_tokens: accumulated.tokensIn + accumulated.tokensOut,
      } : undefined;
      emit(controller, {}, finishReason, usageObj);
    }
    // message_stop and content_block_start/stop are ignored
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

      // Anthropic SSE format: "event: <type>\ndata: <json>\n\n"
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const lines = part.split("\n");
        let eventType = "";
        let dataStr = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            dataStr = line.slice(6);
          }
        }

        if (eventType && dataStr) {
          try {
            const data = JSON.parse(dataStr);
            handleEvent(eventType, data, controller);
          } catch {
            // Skip malformed JSON
          }
        }
      }
    },

    flush(controller) {
      if (buffer.trim()) {
        const lines = buffer.split("\n");
        let eventType = "";
        let dataStr = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7).trim();
          else if (line.startsWith("data: ")) dataStr = line.slice(6);
        }
        if (eventType && dataStr) {
          try {
            handleEvent(eventType, JSON.parse(dataStr), controller);
          } catch { /* ignore */ }
        }
      }

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      callOnDone();
    },
  });
}
