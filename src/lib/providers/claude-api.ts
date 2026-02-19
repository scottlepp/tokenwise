import { BaseProvider } from "./base";
import type { ProviderModel, ProviderRequest, ProviderResponse, ProviderStreamResponse } from "./base";
import { createAnthropicSseTransformer } from "../stream-transformers/anthropic-sse";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; source?: unknown }>;
}

function convertToAnthropicMessages(params: ProviderRequest): {
  system?: string;
  messages: AnthropicMessage[];
} {
  let system: string | undefined;
  const messages: AnthropicMessage[] = [];

  for (const msg of params.messages) {
    if (msg.role === "system") {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
          : "";
      system = system ? `${system}\n\n${text}` : text;
    } else if (msg.role === "user" || msg.role === "assistant") {
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
          : "";
      if (content) {
        messages.push({ role: msg.role, content });
      }
    } else if (msg.role === "tool") {
      // Append tool results as user messages
      const text = typeof msg.content === "string" ? msg.content : "";
      messages.push({ role: "user", content: `[Tool Result: ${msg.name ?? "unknown"}]\n${text}` });
    }
  }

  if (params.systemPrompt) {
    system = system ? `${params.systemPrompt}\n\n${system}` : params.systemPrompt;
  }

  // Anthropic requires messages to alternate user/assistant, starting with user
  // Merge consecutive same-role messages
  const merged: AnthropicMessage[] = [];
  for (const msg of messages) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      const prev = merged[merged.length - 1];
      prev.content = `${prev.content}\n\n${msg.content}`;
    } else {
      merged.push({ ...msg });
    }
  }

  // Ensure it starts with user
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", content: "(continuing conversation)" });
  }

  return { system, messages: merged.length > 0 ? merged : [{ role: "user", content: "" }] };
}

export class ClaudeApiProvider extends BaseProvider {
  readonly id = "claude-api" as const;
  readonly displayName = "Claude (API)";
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
    const { system, messages } = convertToAnthropicMessages(params);
    const modelInfo = this.getModels().find((m) => m.id === params.model) ?? this.models[0];

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 8192,
    };
    if (system) body.system = system;
    if (params.temperature !== undefined) body.temperature = params.temperature;

    console.log("[claude-api] POST %s model=%s messages=%d", ANTHROPIC_API_URL, params.model, messages.length);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[claude-api] Error %d: %s", response.status, errText.slice(0, 500));
      throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, unknown>;

    const content = data.content as Array<Record<string, string>> | undefined;
    const text = content?.filter((b) => b.type === "text").map((b) => b.text).join("") ?? "";

    const usage = data.usage as Record<string, number> | undefined;
    const tokensIn = usage?.input_tokens ?? 0;
    const tokensOut = usage?.output_tokens ?? 0;
    const costUsd = (tokensIn * modelInfo.costPerMInputTokens + tokensOut * modelInfo.costPerMOutputTokens) / 1_000_000;

    const stopReason = data.stop_reason as string | undefined;

    return {
      text,
      tokensIn,
      tokensOut,
      costUsd,
      finishReason: stopReason === "max_tokens" ? "length" : "stop",
    };
  }

  async stream(params: ProviderRequest): Promise<ProviderStreamResponse> {
    const { system, messages } = convertToAnthropicMessages(params);
    const modelInfo = this.getModels().find((m) => m.id === params.model) ?? this.models[0];

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      max_tokens: params.maxTokens ?? 8192,
      stream: true,
    };
    if (system) body.system = system;
    if (params.temperature !== undefined) body.temperature = params.temperature;

    console.log("[claude-api] POST %s model=%s messages=%d stream=true", ANTHROPIC_API_URL, params.model, messages.length);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error("Anthropic API returned no body for streaming request");
    }

    const completionId = `chatcmpl-${crypto.randomUUID()}`;

    let resolveMetadata: (value: ProviderResponse) => void;
    const metadata = new Promise<ProviderResponse>((resolve) => { resolveMetadata = resolve; });

    const transformer = createAnthropicSseTransformer(
      completionId,
      params.model,
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
