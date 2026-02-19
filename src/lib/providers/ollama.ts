import { BaseProvider } from "./base";
import type { ProviderModel, ProviderRequest, ProviderResponse, ProviderStreamResponse } from "./base";
import { createOllamaNdjsonTransformer } from "../stream-transformers/ollama-ndjson";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export class OllamaProvider extends BaseProvider {
  readonly id = "ollama" as const;
  readonly displayName = "Ollama (Local)";
  private baseUrl: string;
  private seedModels: ProviderModel[];
  private discoveredModels: ProviderModel[] | null = null;

  constructor(baseUrl?: string, models?: ProviderModel[]) {
    super();
    this.baseUrl = (baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
    this.seedModels = models ?? [];
  }

  isAvailable(): boolean {
    return true; // Configured by env var, actual reachability checked at request time
  }

  getModels(): ProviderModel[] {
    return this.discoveredModels ?? this.seedModels;
  }

  /** Discover available models from the Ollama API */
  async discoverModels(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return;

      const data = await response.json() as Record<string, unknown>;
      const models = data.models as Array<Record<string, unknown>> | undefined;
      if (!models || models.length === 0) return;

      this.discoveredModels = models.map((m) => ({
        id: m.name as string,
        provider: "ollama" as const,
        displayName: m.name as string,
        tier: "economy" as const,
        costPerMInputTokens: 0,
        costPerMOutputTokens: 0,
        maxContextTokens: 8192,
        supportsStreaming: true,
        supportsTools: false,
        supportsVision: false,
      }));

      console.log("[ollama] Discovered %d models: %s", this.discoveredModels.length, this.discoveredModels.map((m) => m.id).join(", "));
    } catch (err) {
      console.log("[ollama] Model discovery failed:", (err as Error).message);
    }
  }

  async complete(params: ProviderRequest): Promise<ProviderResponse> {
    const messages = params.messages.map((msg) => ({
      role: msg.role === "tool" ? "user" : msg.role,
      content: typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
          : "",
    }));

    // Prepend system prompt
    if (params.systemPrompt) {
      messages.unshift({ role: "system", content: params.systemPrompt });
    }

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: false,
    };
    if (params.temperature !== undefined) {
      body.options = { temperature: params.temperature };
    }

    console.log("[ollama] POST %s/api/chat model=%s messages=%d", this.baseUrl, params.model, messages.length);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[ollama] Error %d: %s", response.status, errText.slice(0, 500));
      throw new Error(`Ollama API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const message = data.message as Record<string, string> | undefined;
    const text = message?.content ?? "";

    const tokensIn = (data.prompt_eval_count as number) ?? 0;
    const tokensOut = (data.eval_count as number) ?? 0;

    return {
      text,
      tokensIn,
      tokensOut,
      costUsd: 0, // Local inference
      finishReason: (data.done_reason as string) === "length" ? "length" : "stop",
    };
  }

  async stream(params: ProviderRequest): Promise<ProviderStreamResponse> {
    const messages = params.messages.map((msg) => ({
      role: msg.role === "tool" ? "user" : msg.role,
      content: typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
          : "",
    }));

    if (params.systemPrompt) {
      messages.unshift({ role: "system", content: params.systemPrompt });
    }

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: true,
    };
    if (params.temperature !== undefined) {
      body.options = { temperature: params.temperature };
    }

    console.log("[ollama] POST %s/api/chat model=%s messages=%d stream=true", this.baseUrl, params.model, messages.length);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error("Ollama API returned no body for streaming request");
    }

    const completionId = `chatcmpl-${crypto.randomUUID()}`;

    let resolveMetadata: (value: ProviderResponse) => void;
    const metadata = new Promise<ProviderResponse>((resolve) => { resolveMetadata = resolve; });

    const transformer = createOllamaNdjsonTransformer(
      completionId,
      params.model,
      (acc) => {
        resolveMetadata!({
          text: acc.text,
          tokensIn: acc.tokensIn,
          tokensOut: acc.tokensOut,
          costUsd: 0,
          finishReason: "stop",
        });
      },
    );

    const outputStream = response.body.pipeThrough(transformer);

    return { stream: outputStream, metadata };
  }
}
