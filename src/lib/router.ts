import { db } from "./db";
import { taskLogs } from "./db/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import type { TaskCategory, ChatMessage, ClassificationResult, RouterDecision } from "./types";
import {
  EXPLICIT_CLAUDE_MODELS,
  MODEL_MAP,
  DEFAULT_MODEL,
  COMPLEXITY_TIER_MAP,
  SUCCESS_THRESHOLD,
  CONSECUTIVE_FAILURE_LIMIT,
  DEFAULT_PROVIDER,
  TIER_NAMES,
  LEGACY_MODEL_TIER_MAP,
  modelAlias,
} from "./config";
import { classifyTask } from "./task-classifier";
import { providerRegistry, initializeProviders } from "./providers";
import type { ModelTier, ProviderModel } from "./providers/base";

const EXPLORE_RATE = 0.2;
const MIN_SAMPLES_FOR_CONFIDENCE = 3;

interface SuccessStats {
  provider: string;
  model: string;
  totalCount: number;
  successCount: number;
  successRate: number;
}

async function getSuccessRates(category: TaskCategory, sinceDays: number = 7): Promise<SuccessStats[]> {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const rows = await db
    .select({
      provider: taskLogs.provider,
      model: taskLogs.modelSelected,
      totalCount: sql<number>`count(*)::int`,
      successCount: sql<number>`count(*) filter (where ${taskLogs.cliSuccess} = true and (${taskLogs.heuristicScore} is null or ${taskLogs.heuristicScore} >= 40))::int`,
    })
    .from(taskLogs)
    .where(and(eq(taskLogs.taskCategory, category), gte(taskLogs.createdAt, since)))
    .groupBy(taskLogs.provider, taskLogs.modelSelected);

  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    totalCount: r.totalCount,
    successCount: r.successCount,
    successRate: r.totalCount > 0 ? r.successCount / r.totalCount : 0,
  }));
}

async function getConsecutiveFailures(category: TaskCategory, provider: string, model: string): Promise<number> {
  const recent = await db
    .select({ cliSuccess: taskLogs.cliSuccess, heuristicScore: taskLogs.heuristicScore })
    .from(taskLogs)
    .where(and(
      eq(taskLogs.taskCategory, category),
      eq(taskLogs.provider, provider),
      eq(taskLogs.modelSelected, model),
    ))
    .orderBy(desc(taskLogs.createdAt))
    .limit(CONSECUTIVE_FAILURE_LIMIT);

  let failures = 0;
  for (const row of recent) {
    const isFailure = !row.cliSuccess || (row.heuristicScore !== null && row.heuristicScore < 40);
    if (isFailure) failures++;
    else break;
  }
  return failures;
}

function complexityToTier(score: number): ModelTier {
  if (score <= COMPLEXITY_TIER_MAP.low.max) return "economy";
  if (score <= COMPLEXITY_TIER_MAP.medium.max) return "standard";
  return "premium";
}

function displayAlias(provider: string, model: string): string {
  const alias = modelAlias(model);
  if (provider === "claude-cli" || provider === "claude-api") return alias;
  return `${provider}/${model}`;
}

export type SelectModelResult = {
  decision: RouterDecision;
  classificationLlm?: ClassificationResult["llm"];
};

export async function selectModel(
  requestedModel: string,
  messages: ChatMessage[]
): Promise<SelectModelResult> {
  await initializeProviders();

  // ── 1. Check for provider:model syntax (e.g., "openai:gpt-4o") ──
  if (requestedModel.includes(":")) {
    const [providerPrefix, modelName] = requestedModel.split(":", 2);
    const provider = providerRegistry.get(providerPrefix);
    if (provider) {
      const providerModel = provider.getModels().find((m) => m.id === modelName);
      if (providerModel) {
        const classification = await classifyTask(messages);
        return {
          decision: {
            provider: providerPrefix,
            model: modelName,
            alias: displayAlias(providerPrefix, modelName),
            reason: `User requested ${providerPrefix}:${modelName}`,
            category: classification.category,
            complexityScore: classification.complexityScore,
          },
          classificationLlm: classification.llm,
        };
      }
    }
  }

  // ── 2. Check for explicit Claude model names/aliases ──
  if (EXPLICIT_CLAUDE_MODELS.has(requestedModel)) {
    const model = MODEL_MAP[requestedModel] ?? DEFAULT_MODEL;
    // Prefer claude-api over claude-cli if available
    const provider = providerRegistry.get("claude-api")?.isAvailable() ? "claude-api" : "claude-cli";
    const classification = await classifyTask(messages);
    return {
      decision: {
        provider,
        model,
        alias: modelAlias(model),
        reason: `User requested ${requestedModel}`,
        category: classification.category,
        complexityScore: classification.complexityScore,
      },
      classificationLlm: classification.llm,
    };
  }

  // ── 3. Check if requested model exists in any provider ──
  const exactMatch = providerRegistry.findProviderForModel(requestedModel);
  if (exactMatch) {
    const classification = await classifyTask(messages);
    return {
      decision: {
        provider: exactMatch.provider.id,
        model: exactMatch.model.id,
        alias: displayAlias(exactMatch.provider.id, exactMatch.model.id),
        reason: `User requested ${requestedModel} (${exactMatch.provider.displayName})`,
        category: classification.category,
        complexityScore: classification.complexityScore,
      },
      classificationLlm: classification.llm,
    };
  }

  // ── 4. Check for tier names ──
  if (TIER_NAMES.has(requestedModel)) {
    const tier = requestedModel as ModelTier;
    const classification = await classifyTask(messages);
    const selected = await selectFromTier(tier, classification.category, classification.complexityScore);
    return {
      decision: {
        ...selected,
        reason: `User requested ${tier} tier -> ${selected.provider}/${selected.model}`,
      },
      classificationLlm: classification.llm,
    };
  }

  // ── 5. Check legacy OpenAI model names → map to tier ──
  if (LEGACY_MODEL_TIER_MAP[requestedModel]) {
    const tier = LEGACY_MODEL_TIER_MAP[requestedModel];
    const classification = await classifyTask(messages);
    const selected = await selectFromTier(tier, classification.category, classification.complexityScore);
    return {
      decision: {
        ...selected,
        reason: `Legacy "${requestedModel}" -> ${tier} tier -> ${selected.provider}/${selected.model}`,
      },
      classificationLlm: classification.llm,
    };
  }

  // ── 6. "auto" or unknown → full smart routing ──
  const classification = await classifyTask(messages);
  const { category, complexityScore, llm: classificationLlm } = classification;
  const requiredTier = complexityToTier(complexityScore);

  const selected = await selectFromTier(requiredTier, category, complexityScore);

  return {
    decision: {
      ...selected,
      category,
      complexityScore,
    },
    classificationLlm,
  };
}

/** Select the best model from a given tier using cost + success rate data */
async function selectFromTier(
  tier: ModelTier,
  category: TaskCategory,
  complexityScore: number,
): Promise<RouterDecision> {
  const models = providerRegistry.getModelsByCost(tier);

  if (models.length === 0) {
    // No models in tier — try escalating
    const tierOrder: ModelTier[] = ["economy", "standard", "premium"];
    const currentIdx = tierOrder.indexOf(tier);
    for (let i = currentIdx + 1; i < tierOrder.length; i++) {
      const escalated = providerRegistry.getModelsByCost(tierOrder[i]);
      if (escalated.length > 0) {
        const m = escalated[0];
        return {
          provider: m.provider,
          model: m.id,
          alias: displayAlias(m.provider, m.id),
          reason: `No ${tier} models, escalated to ${tierOrder[i]}: ${m.provider}/${m.id}`,
          category,
          complexityScore,
        };
      }
    }

    // No providers at all — fall back to Claude CLI default
    return {
      provider: "claude-cli",
      model: DEFAULT_MODEL,
      alias: modelAlias(DEFAULT_MODEL),
      reason: `No providers available, defaulting to ${modelAlias(DEFAULT_MODEL)}`,
      category,
      complexityScore,
    };
  }

  // Try historical success-based selection
  try {
    const stats = await getSuccessRates(category);
    const hasHistory = stats.length > 0 && stats.some((s) => s.totalCount >= MIN_SAMPLES_FOR_CONFIDENCE);

    if (hasHistory) {
      // Check for cheaper untested models (exploration)
      const cheaperUntested: ProviderModel[] = [];
      for (const m of models) {
        const modelStats = stats.find((s) => s.provider === m.provider && s.model === m.id);
        if (!modelStats || modelStats.totalCount < MIN_SAMPLES_FOR_CONFIDENCE) {
          cheaperUntested.push(m);
        }
      }

      if (cheaperUntested.length > 0 && Math.random() < EXPLORE_RATE) {
        const exploreModel = cheaperUntested[0];
        return {
          provider: exploreModel.provider,
          model: exploreModel.id,
          alias: displayAlias(exploreModel.provider, exploreModel.id),
          reason: `Explore: ${exploreModel.provider}/${exploreModel.id} for ${category} (no history)`,
          category,
          complexityScore,
        };
      }

      // Normal path: pick cheapest model above threshold
      for (const m of models) {
        const modelStats = stats.find((s) => s.provider === m.provider && s.model === m.id);
        if (!modelStats || modelStats.totalCount < MIN_SAMPLES_FOR_CONFIDENCE) continue;
        if (modelStats.successRate < SUCCESS_THRESHOLD) continue;

        const failures = await getConsecutiveFailures(category, m.provider, m.id);
        if (failures >= CONSECUTIVE_FAILURE_LIMIT) continue;

        return {
          provider: m.provider,
          model: m.id,
          alias: displayAlias(m.provider, m.id),
          reason: `${m.provider}/${m.id}: cheapest ${tier}, ${Math.round(modelStats.successRate * 100)}% success for ${category} (n=${modelStats.totalCount})`,
          category,
          complexityScore,
        };
      }
    }
  } catch {
    // DB query failed — fall through to cost-based
  }

  // Fallback: cheapest model in tier, prefer default provider
  const defaultProviderModel = models.find((m) => m.provider === DEFAULT_PROVIDER);
  const selected = defaultProviderModel ?? models[0];

  return {
    provider: selected.provider,
    model: selected.id,
    alias: displayAlias(selected.provider, selected.id),
    reason: `${selected.provider}/${selected.id}: cheapest ${tier} (cost-based${defaultProviderModel ? ", preferred" : ""})`,
    category,
    complexityScore,
  };
}
