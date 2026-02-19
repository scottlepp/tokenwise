import { BaseProvider } from "./base";
import type { ProviderModel, ProviderRequest, ProviderResponse, ProviderStreamResponse } from "./base";
import { createOpenAIPassthroughTransformer } from "../stream-transformers/openai-passthrough";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAIProvider extends BaseProvider {
  readonly id = "openai" as const;
  readonly displayName = "OpenAI";
  private apiKey: string;
  private models: ProviderModel[];

  constructor(apiKey: string, models?: ProviderModel[]) {
    super();
    this.apiKey = apiKey;
    this.models = models ?? [];
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getModels(): ProviderModel[] {
    return this.models;
  }

  async complete(params: ProviderRequest): Promise<ProviderResponse> {
    const modelInfo = this.getModels().find((m) => m.id === params.model) ?? this.models[0];

    // Build OpenAI-format messages (already in the right format)
    const messages = params.messages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p) => p.type === "text" ? { type: "text" as const, text: (p as { text: string }).text } : p)
          : msg.content,
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
      ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
      ...(msg.name ? { name: msg.name } : {}),
    }));

    // If there's a separate system prompt, prepend it
    if (params.systemPrompt) {
      messages.unshift({ role: "system", content: params.systemPrompt });
    }

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (params.tools && params.tools.length > 0) body.tools = params.tools;

    console.log("[openai] POST %s model=%s messages=%d", OPENAI_API_URL, params.model, messages.length);

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[openai] Error %d: %s", response.status, errText.slice(0, 500));
      throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    const message = choice?.message as Record<string, unknown> | undefined;

    const text = (message?.content as string) ?? "";
    const toolCalls = message?.tool_calls as Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> | undefined;

    const usage = data.usage as Record<string, number> | undefined;
    const tokensIn = usage?.prompt_tokens ?? 0;
    const tokensOut = usage?.completion_tokens ?? 0;
    const costUsd = (tokensIn * modelInfo.costPerMInputTokens + tokensOut * modelInfo.costPerMOutputTokens) / 1_000_000;

    const finishReason = choice?.finish_reason as string | undefined;

    return {
      text,
      tokensIn,
      tokensOut,
      costUsd,
      finishReason: finishReason === "tool_calls" ? "tool_calls" : finishReason === "length" ? "length" : "stop",
      toolCalls,
    };
  }

  async stream(params: ProviderRequest): Promise<ProviderStreamResponse> {
    const modelInfo = this.getModels().find((m) => m.id === params.model) ?? this.models[0];

    const messages = params.messages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p) => p.type === "text" ? { type: "text" as const, text: (p as { text: string }).text } : p)
          : msg.content,
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
      ...(msg.tool_call_id ? { tool_call_id: msg.tool_call_id } : {}),
      ...(msg.name ? { name: msg.name } : {}),
    }));

    if (params.systemPrompt) {
      messages.unshift({ role: "system", content: params.systemPrompt });
    }

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (params.tools && params.tools.length > 0) body.tools = params.tools;

    console.log("[openai] POST %s model=%s messages=%d stream=true", OPENAI_API_URL, params.model, messages.length);

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error("OpenAI API returned no body for streaming request");
    }

    let resolveMetadata: (value: ProviderResponse) => void;
    const metadata = new Promise<ProviderResponse>((resolve) => { resolveMetadata = resolve; });

    const transformer = createOpenAIPassthroughTransformer(
      modelInfo.costPerMInputTokens,
      modelInfo.costPerMOutputTokens,
      (acc) => {
        resolveMetadata!({
          text: acc.text,
          tokensIn: acc.tokensIn,
          tokensOut: acc.tokensOut,
          costUsd: acc.costUsd,
          finishReason: "stop",
        });
      },
    );

    const outputStream = response.body.pipeThrough(transformer);

    return { stream: outputStream, metadata };
  }
}
