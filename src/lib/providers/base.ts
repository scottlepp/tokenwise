import type { ChatMessage, ToolDefinition } from "../types";

export type ProviderId =
  | "claude-cli"
  | "claude-api"
  | "openai"
  | "gemini"
  | "ollama"
  | string;

export type ModelTier = "economy" | "standard" | "premium";

export interface ProviderModel {
  id: string;
  provider: ProviderId;
  displayName: string;
  tier: ModelTier;
  costPerMInputTokens: number;
  costPerMOutputTokens: number;
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
}

export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string | null;
  stream: boolean;
  tools?: ToolDefinition[];
  toolChoice?: string | { type: string; function?: { name: string } };
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  finishReason: "stop" | "length" | "tool_calls";
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ProviderStreamResponse {
  stream: ReadableStream<Uint8Array>;
  metadata: Promise<ProviderResponse>;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly displayName: string;

  isAvailable(): boolean;
  getModels(): ProviderModel[];

  complete(params: ProviderRequest): Promise<ProviderResponse>;
  stream(params: ProviderRequest): Promise<ProviderStreamResponse>;

  healthCheck?(): Promise<boolean>;
}

export abstract class BaseProvider implements LLMProvider {
  abstract readonly id: ProviderId;
  abstract readonly displayName: string;

  abstract isAvailable(): boolean;
  abstract getModels(): ProviderModel[];
  abstract complete(params: ProviderRequest): Promise<ProviderResponse>;
  abstract stream(params: ProviderRequest): Promise<ProviderStreamResponse>;

  estimateCost(model: string, tokensIn: number, tokensOut: number): number {
    const m = this.getModels().find((mod) => mod.id === model);
    if (!m) return 0;
    return (tokensIn * m.costPerMInputTokens + tokensOut * m.costPerMOutputTokens) / 1_000_000;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const models = this.getModels();
      if (models.length === 0) return false;
      const result = await this.complete({
        model: models[0].id,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
      });
      return result.text.length > 0;
    } catch {
      return false;
    }
  }
}
