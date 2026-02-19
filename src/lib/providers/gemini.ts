import { BaseProvider } from "./base";
import type { ProviderModel, ProviderRequest, ProviderResponse, ProviderStreamResponse } from "./base";
import { createGeminiSseTransformer } from "../stream-transformers/gemini-sse";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

function convertToGeminiFormat(params: ProviderRequest): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
} {
  let systemText = "";
  const contents: GeminiContent[] = [];

  for (const msg of params.messages) {
    if (msg.role === "system") {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
          : "";
      systemText = systemText ? `${systemText}\n\n${text}` : text;
    } else if (msg.role === "user" || msg.role === "tool") {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
          : "";
      if (text) {
        const role = "user" as const;
        // Merge consecutive user messages
        if (contents.length > 0 && contents[contents.length - 1].role === role) {
          contents[contents.length - 1].parts.push({ text });
        } else {
          contents.push({ role, parts: [{ text }] });
        }
      }
    } else if (msg.role === "assistant") {
      const text = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n")
          : "";
      if (text) {
        contents.push({ role: "model", parts: [{ text }] });
      }
    }
  }

  if (params.systemPrompt) {
    systemText = params.systemPrompt + (systemText ? `\n\n${systemText}` : "");
  }

  // Gemini requires contents to start with user
  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "" }] });
  } else if (contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "(continuing conversation)" }] });
  }

  const result: { systemInstruction?: { parts: Array<{ text: string }> }; contents: GeminiContent[] } = { contents };
  if (systemText) {
    result.systemInstruction = { parts: [{ text: systemText }] };
  }

  return result;
}

export class GeminiProvider extends BaseProvider {
  readonly id = "gemini" as const;
  readonly displayName = "Google Gemini";
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
    const { systemInstruction, contents } = convertToGeminiFormat(params);

    const url = `${GEMINI_BASE_URL}/${params.model}:generateContent?key=${this.apiKey}`;

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.system_instruction = systemInstruction;
    if (params.temperature !== undefined) {
      body.generationConfig = { temperature: params.temperature };
    }
    if (params.maxTokens) {
      body.generationConfig = { ...(body.generationConfig as object ?? {}), maxOutputTokens: params.maxTokens };
    }

    console.log("[gemini] POST model=%s contents=%d", params.model, contents.length);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[gemini] Error %d: %s", response.status, errText.slice(0, 500));
      throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, unknown>;

    const candidates = data.candidates as Array<Record<string, unknown>> | undefined;
    const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
    const parts = content?.parts as Array<Record<string, string>> | undefined;
    const text = parts?.map((p) => p.text).filter(Boolean).join("") ?? "";

    const usageMetadata = data.usageMetadata as Record<string, number> | undefined;
    const tokensIn = usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = usageMetadata?.candidatesTokenCount ?? 0;
    const costUsd = (tokensIn * modelInfo.costPerMInputTokens + tokensOut * modelInfo.costPerMOutputTokens) / 1_000_000;

    const finishReason = candidates?.[0]?.finishReason as string | undefined;

    return {
      text,
      tokensIn,
      tokensOut,
      costUsd,
      finishReason: finishReason === "MAX_TOKENS" ? "length" : "stop",
    };
  }

  async stream(params: ProviderRequest): Promise<ProviderStreamResponse> {
    const modelInfo = this.getModels().find((m) => m.id === params.model) ?? this.models[0];
    const { systemInstruction, contents } = convertToGeminiFormat(params);

    const url = `${GEMINI_BASE_URL}/${params.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const body: Record<string, unknown> = { contents };
    if (systemInstruction) body.system_instruction = systemInstruction;
    if (params.temperature !== undefined) {
      body.generationConfig = { temperature: params.temperature };
    }
    if (params.maxTokens) {
      body.generationConfig = { ...(body.generationConfig as object ?? {}), maxOutputTokens: params.maxTokens };
    }

    console.log("[gemini] POST model=%s contents=%d stream=true", params.model, contents.length);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error("Gemini API returned no body for streaming request");
    }

    const completionId = `chatcmpl-${crypto.randomUUID()}`;

    let resolveMetadata: (value: ProviderResponse) => void;
    const metadata = new Promise<ProviderResponse>((resolve) => { resolveMetadata = resolve; });

    const transformer = createGeminiSseTransformer(
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
