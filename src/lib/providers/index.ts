import type { LLMProvider, ProviderId, ProviderModel, ModelTier } from "./base";
import { db } from "../db";
import { providerConfig, modelsTable } from "../db/schema";
import { eq } from "drizzle-orm";
import { seedProvidersAndModels } from "../db/seed";

export type { LLMProvider, ProviderId, ProviderModel, ModelTier, ProviderRequest, ProviderResponse, ProviderStreamResponse } from "./base";
export { BaseProvider } from "./base";

class ProviderRegistry {
  private providers: Map<ProviderId, LLMProvider> = new Map();

  register(provider: LLMProvider): void {
    console.log(`[registry] Registered provider: ${provider.id} (${provider.displayName})`);
    this.providers.set(provider.id, provider);
  }

  unregister(id: ProviderId): void {
    this.providers.delete(id);
  }

  clear(): void {
    this.providers.clear();
  }

  get(id: ProviderId): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getEnabled(): LLMProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.isAvailable());
  }

  getAllModels(): ProviderModel[] {
    const models: ProviderModel[] = [];
    for (const provider of this.getEnabled()) {
      models.push(...provider.getModels());
    }
    return models;
  }

  getModelsByCost(tier?: ModelTier): ProviderModel[] {
    let models = this.getAllModels();
    if (tier) {
      models = models.filter((m) => m.tier === tier);
    }
    return models.sort((a, b) => a.costPerMInputTokens - b.costPerMInputTokens);
  }

  /** Find which provider owns a given model ID */
  findProviderForModel(modelId: string): { provider: LLMProvider; model: ProviderModel } | null {
    for (const provider of this.getEnabled()) {
      const model = provider.getModels().find((m) => m.id === modelId);
      if (model) return { provider, model };
    }
    return null;
  }

  /** Get all provider IDs */
  getProviderIds(): ProviderId[] {
    return Array.from(this.providers.keys());
  }

  /** Check if any providers are registered */
  hasProviders(): boolean {
    return this.providers.size > 0;
  }
}

export const providerRegistry = new ProviderRegistry();

let initialized = false;

/** Load models from DB for a given provider */
async function loadModelsForProvider(providerId: string): Promise<ProviderModel[]> {
  const rows = await db
    .select()
    .from(modelsTable)
    .where(eq(modelsTable.providerId, providerId));

  return rows
    .filter((r) => r.enabled)
    .map((r) => ({
      id: r.modelId,
      provider: r.providerId,
      displayName: r.displayName,
      tier: r.tier as ModelTier,
      costPerMInputTokens: Number(r.costPerMInputTokens),
      costPerMOutputTokens: Number(r.costPerMOutputTokens),
      maxContextTokens: r.maxContextTokens,
      supportsStreaming: r.supportsStreaming,
      supportsTools: r.supportsTools,
      supportsVision: r.supportsVision,
    }));
}

/** Get an API key for a provider: check DB configJson first, then fall back to env var */
function getApiKey(
  dbConfig: { configJson: unknown } | undefined,
  envVar: string
): string | undefined {
  const json = dbConfig?.configJson as Record<string, unknown> | undefined;
  if (json?.apiKey && typeof json.apiKey === "string") {
    return json.apiKey;
  }
  return process.env[envVar] || undefined;
}

/** Get a config value from DB configJson with env var fallback */
function getConfigValue(
  dbConfig: { configJson: unknown } | undefined,
  key: string,
  envVar?: string,
  defaultValue?: string
): string | undefined {
  const json = dbConfig?.configJson as Record<string, unknown> | undefined;
  if (json?.[key] && typeof json[key] === "string") {
    return json[key] as string;
  }
  if (envVar) return process.env[envVar] || defaultValue;
  return defaultValue;
}

/** Known built-in provider types */
const BUILTIN_PROVIDER_TYPES = new Set([
  "claude-cli",
  "claude-api",
  "openai",
  "gemini",
  "ollama",
]);

export async function initializeProviders(): Promise<void> {
  if (initialized) return;
  initialized = true;

  console.log("[registry] Initializing providers...");

  // Seed providers + models on first run (idempotent)
  try {
    await seedProvidersAndModels();
  } catch (err) {
    console.error("[registry] Seed failed:", (err as Error).message);
  }

  await loadAndRegisterProviders();
}

/** Re-initialize providers after config changes (e.g., adding/removing providers via UI) */
export async function reinitializeProviders(): Promise<void> {
  console.log("[registry] Reinitializing providers...");
  providerRegistry.clear();
  await loadAndRegisterProviders();
}

/** Core logic: load provider configs from DB and register each one */
async function loadAndRegisterProviders(): Promise<void> {
  const dbProviders = await db.select().from(providerConfig);
  const configMap = new Map(dbProviders.map((p) => [p.providerId, p]));

  for (const dbProv of dbProviders) {
    if (!dbProv.enabled) continue;

    const providerId = dbProv.providerId;

    try {
      if (providerId === "claude-cli") {
        const models = await loadModelsForProvider("claude-cli");
        const { ClaudeCliProvider } = await import("./claude-cli");
        const cliProvider = new ClaudeCliProvider(models);
        if (cliProvider.isAvailable()) {
          providerRegistry.register(cliProvider);
        }
      } else if (providerId === "claude-api") {
        const apiKey = getApiKey(configMap.get("claude-api"), "ANTHROPIC_API_KEY");
        if (apiKey) {
          const models = await loadModelsForProvider("claude-api");
          const { ClaudeApiProvider } = await import("./claude-api");
          providerRegistry.register(new ClaudeApiProvider(apiKey, models));
        }
      } else if (providerId === "openai") {
        const apiKey = getApiKey(configMap.get("openai"), "OPENAI_API_KEY");
        if (apiKey) {
          const models = await loadModelsForProvider("openai");
          const { OpenAIProvider } = await import("./openai");
          providerRegistry.register(new OpenAIProvider(apiKey, models));
        }
      } else if (providerId === "gemini") {
        const apiKey = getApiKey(configMap.get("gemini"), "GEMINI_API_KEY");
        if (apiKey) {
          const models = await loadModelsForProvider("gemini");
          const { GeminiProvider } = await import("./gemini");
          providerRegistry.register(new GeminiProvider(apiKey, models));
        }
      } else if (providerId === "ollama") {
        const baseUrl = getConfigValue(configMap.get("ollama"), "baseUrl", "OLLAMA_BASE_URL", "http://localhost:11434");
        if (baseUrl) {
          const models = await loadModelsForProvider("ollama");
          const { OllamaProvider } = await import("./ollama");
          providerRegistry.register(new OllamaProvider(baseUrl, models));
        }
      } else {
        // Custom/unknown provider — treat as OpenAI-compatible
        const json = dbProv.configJson as Record<string, unknown> | undefined;
        const apiKey = json?.apiKey as string | undefined;
        const baseUrl = json?.baseUrl as string | undefined;
        if (apiKey && baseUrl) {
          const models = await loadModelsForProvider(providerId);
          const { OpenAICompatibleProvider } = await import("./openai-compatible");
          providerRegistry.register(new OpenAICompatibleProvider({
            id: providerId,
            displayName: dbProv.displayName,
            baseUrl,
            apiKey,
            models: models.map((m) => ({
              id: m.id,
              displayName: m.displayName,
              tier: m.tier,
              costPerMInput: m.costPerMInputTokens,
              costPerMOutput: m.costPerMOutputTokens,
              maxContext: m.maxContextTokens,
              supportsTools: m.supportsTools,
              supportsVision: m.supportsVision,
            })),
          }));
        }
      }
    } catch (err) {
      console.log(`[registry] Provider ${providerId} failed:`, (err as Error).message);
    }
  }

  // Also load custom providers from CUSTOM_PROVIDERS env var (backward compat)
  if (process.env.CUSTOM_PROVIDERS) {
    try {
      const configs = JSON.parse(process.env.CUSTOM_PROVIDERS);
      const { OpenAICompatibleProvider } = await import("./openai-compatible");
      for (const cfg of configs) {
        // Skip if already registered from DB
        if (providerRegistry.get(cfg.id)) continue;
        providerRegistry.register(new OpenAICompatibleProvider(cfg));
      }
    } catch (err) {
      console.log("[registry] Custom providers (env) failed:", (err as Error).message);
    }
  }

  const enabled = providerRegistry.getEnabled();
  console.log("[registry] %d providers active: %s", enabled.length, enabled.map((p) => p.id).join(", "));
  console.log("[registry] %d models available", providerRegistry.getAllModels().length);
}

/** Check if a provider ID is a known built-in type */
export function isBuiltinProvider(providerId: string): boolean {
  return BUILTIN_PROVIDER_TYPES.has(providerId);
}
