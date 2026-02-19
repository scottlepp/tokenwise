import { BaseProvider } from "./base";
import type { ProviderId, ProviderModel, ModelTier, ProviderRequest, ProviderResponse, ProviderStreamResponse } from "./base";
import { createOpenAIPassthroughTransformer } from "../stream-transformers/openai-passthrough";

export interface CustomProviderConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{
    id: string;
    displayName?: string;
    tier: ModelTier;
    costPerMInput: number;
    costPerMOutput: number;
    maxContext: number;
    supportsTools?: boolean;
    supportsVision?: boolean;
  }>;
}

export class OpenAICompatibleProvider extends BaseProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  private baseUrl: string;
  private apiKey: string;
  private models: ProviderModel[];

  constructor(config: CustomProviderConfig) {
    super();
    this.id = config.id;
    this.displayName = config.displayName;
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.models = config.models.map((m) => ({
      id: m.id,
      provider: config.id,
      displayName: m.displayName ?? m.id,
      tier: m.tier,
      costPerMInputTokens: m.costPerMInput,
      costPerMOutputTokens: m.costPerMOutput,
      maxContextTokens: m.maxContext,
      supportsStreaming: true,
      supportsTools: m.supportsTools ?? false,
      supportsVision: m.supportsVision ?? false,
    }));
  }

  isAvailable(): boolean {
    return !!this.apiKey && this.models.length > 0;
  }

  getModels(): ProviderModel[] {
    return this.models;
  }

  async complete(params: ProviderRequest): Promise<ProviderResponse> {
    const modelInfo = this.getModels().find((m) => m.id === params.model) ?? this.models[0];

    const messages = params.messages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
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
    };
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (params.tools && params.tools.length > 0) body.tools = params.tools;

    const url = `${this.baseUrl}/chat/completions`;
    console.log("[%s] POST %s model=%s messages=%d", this.id, url, params.model, messages.length);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[%s] Error %d: %s", this.id, response.status, errText.slice(0, 500));
      throw new Error(`${this.displayName} API error ${response.status}: ${errText.slice(0, 200)}`);
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
          ? msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
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

    const url = `${this.baseUrl}/chat/completions`;
    console.log("[%s] POST %s model=%s messages=%d stream=true", this.id, url, params.model, messages.length);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${this.displayName} API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error(`${this.displayName} API returned no body for streaming request`);
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
