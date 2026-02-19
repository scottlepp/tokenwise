import { db } from ".";
import { providerConfig, modelsTable } from "./schema";
import { sql } from "drizzle-orm";

interface SeedModel {
  modelId: string;
  displayName: string;
  tier: "economy" | "standard" | "premium";
  costPerMInputTokens: number;
  costPerMOutputTokens: number;
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
}

interface SeedProvider {
  providerId: string;
  displayName: string;
  priority: number;
  models: SeedModel[];
}

const SEED_PROVIDERS: SeedProvider[] = [
  {
    providerId: "claude-cli",
    displayName: "Claude (CLI)",
    priority: 10,
    models: [
      {
        modelId: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        tier: "premium",
        costPerMInputTokens: 5,
        costPerMOutputTokens: 25,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      {
        modelId: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        tier: "standard",
        costPerMInputTokens: 3,
        costPerMOutputTokens: 15,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      {
        modelId: "claude-sonnet-4-5-20250929",
        displayName: "Claude Sonnet 4.5",
        tier: "standard",
        costPerMInputTokens: 3,
        costPerMOutputTokens: 15,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
      {
        modelId: "claude-haiku-4-5-20251001",
        displayName: "Claude Haiku 4.5",
        tier: "economy",
        costPerMInputTokens: 1,
        costPerMOutputTokens: 5,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
    ],
  },
  {
    providerId: "claude-api",
    displayName: "Claude (API)",
    priority: 9,
    models: [
      {
        modelId: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        tier: "premium",
        costPerMInputTokens: 5,
        costPerMOutputTokens: 25,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        tier: "standard",
        costPerMInputTokens: 3,
        costPerMOutputTokens: 15,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "claude-sonnet-4-5-20250929",
        displayName: "Claude Sonnet 4.5",
        tier: "standard",
        costPerMInputTokens: 3,
        costPerMOutputTokens: 15,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "claude-haiku-4-5-20251001",
        displayName: "Claude Haiku 4.5",
        tier: "economy",
        costPerMInputTokens: 1,
        costPerMOutputTokens: 5,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
    ],
  },
  {
    providerId: "openai",
    displayName: "OpenAI",
    priority: 5,
    models: [
      {
        modelId: "gpt-4o",
        displayName: "GPT-4o",
        tier: "standard",
        costPerMInputTokens: 2.5,
        costPerMOutputTokens: 10,
        maxContextTokens: 128000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "gpt-4o-mini",
        displayName: "GPT-4o Mini",
        tier: "economy",
        costPerMInputTokens: 0.15,
        costPerMOutputTokens: 0.6,
        maxContextTokens: 128000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "gpt-4-turbo",
        displayName: "GPT-4 Turbo",
        tier: "premium",
        costPerMInputTokens: 10,
        costPerMOutputTokens: 30,
        maxContextTokens: 128000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "o1",
        displayName: "o1",
        tier: "premium",
        costPerMInputTokens: 15,
        costPerMOutputTokens: 60,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "o3-mini",
        displayName: "o3-mini",
        tier: "economy",
        costPerMInputTokens: 1.1,
        costPerMOutputTokens: 4.4,
        maxContextTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
      },
    ],
  },
  {
    providerId: "gemini",
    displayName: "Google Gemini",
    priority: 5,
    models: [
      {
        modelId: "gemini-2.0-flash",
        displayName: "Gemini 2.0 Flash",
        tier: "economy",
        costPerMInputTokens: 0.075,
        costPerMOutputTokens: 0.3,
        maxContextTokens: 1048576,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "gemini-2.0-pro",
        displayName: "Gemini 2.0 Pro",
        tier: "standard",
        costPerMInputTokens: 1.25,
        costPerMOutputTokens: 10,
        maxContextTokens: 2097152,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "gemini-1.5-pro",
        displayName: "Gemini 1.5 Pro",
        tier: "premium",
        costPerMInputTokens: 1.25,
        costPerMOutputTokens: 5,
        maxContextTokens: 2097152,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "gemini-1.5-flash",
        displayName: "Gemini 1.5 Flash",
        tier: "economy",
        costPerMInputTokens: 0.075,
        costPerMOutputTokens: 0.3,
        maxContextTokens: 1048576,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
      },
    ],
  },
  {
    providerId: "ollama",
    displayName: "Ollama (Local)",
    priority: 3,
    models: [
      {
        modelId: "llama3",
        displayName: "Llama 3",
        tier: "economy",
        costPerMInputTokens: 0,
        costPerMOutputTokens: 0,
        maxContextTokens: 8192,
        supportsStreaming: true,
        supportsTools: false,
        supportsVision: false,
      },
      {
        modelId: "codellama",
        displayName: "Code Llama",
        tier: "economy",
        costPerMInputTokens: 0,
        costPerMOutputTokens: 0,
        maxContextTokens: 16384,
        supportsStreaming: true,
        supportsTools: false,
        supportsVision: false,
      },
      {
        modelId: "mistral",
        displayName: "Mistral",
        tier: "economy",
        costPerMInputTokens: 0,
        costPerMOutputTokens: 0,
        maxContextTokens: 32768,
        supportsStreaming: true,
        supportsTools: false,
        supportsVision: false,
      },
    ],
  },
];

/** Idempotent seed — inserts providers and models if they don't exist */
export async function seedProvidersAndModels(): Promise<void> {
  for (const provider of SEED_PROVIDERS) {
    // Upsert provider
    await db
      .insert(providerConfig)
      .values({
        providerId: provider.providerId,
        displayName: provider.displayName,
        priority: provider.priority,
        enabled: false,
      })
      .onConflictDoNothing({ target: providerConfig.providerId });

    // Upsert models
    for (const model of provider.models) {
      await db
        .insert(modelsTable)
        .values({
          modelId: model.modelId,
          providerId: provider.providerId,
          displayName: model.displayName,
          tier: model.tier,
          costPerMInputTokens: String(model.costPerMInputTokens),
          costPerMOutputTokens: String(model.costPerMOutputTokens),
          maxContextTokens: model.maxContextTokens,
          supportsStreaming: model.supportsStreaming,
          supportsTools: model.supportsTools,
          supportsVision: model.supportsVision,
        })
        .onConflictDoUpdate({
          target: [modelsTable.providerId, modelsTable.modelId],
          set: {
            // Only update fields that should sync from seed (not user-editable ones like enabled)
            displayName: sql`excluded.display_name`,
            updatedAt: sql`now()`,
          },
        });
    }
  }

  console.log("[seed] Providers and models seeded");
}
