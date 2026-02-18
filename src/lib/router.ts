import { db } from "./db";
import { taskLogs } from "./db/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import type { TaskCategory, ClaudeModel, RouterDecision, ChatMessage, ClassificationResult } from "./types";
import {
  MODEL_MAP,
  EXPLICIT_CLAUDE_MODELS,
  DEFAULT_MODEL,
  COMPLEXITY_TIERS,
  SUCCESS_THRESHOLD,
  CONSECUTIVE_FAILURE_LIMIT,
  modelAlias,
} from "./config";
import { classifyTask } from "./task-classifier";

const MODEL_COST_ORDER: ClaudeModel[] = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5-20250929",
  "claude-opus-4-6",
];

// Exploration: try cheaper untested models this % of the time
const EXPLORE_RATE = 0.2; // 20% of requests explore cheaper models
const MIN_SAMPLES_FOR_CONFIDENCE = 3;

interface SuccessStats {
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
      model: taskLogs.modelSelected,
      totalCount: sql<number>`count(*)::int`,
      successCount: sql<number>`count(*) filter (where ${taskLogs.cliSuccess} = true and (${taskLogs.heuristicScore} is null or ${taskLogs.heuristicScore} >= 40))::int`,
    })
    .from(taskLogs)
    .where(and(eq(taskLogs.taskCategory, category), gte(taskLogs.createdAt, since)))
    .groupBy(taskLogs.modelSelected);

  return rows.map((r) => ({
    model: r.model,
    totalCount: r.totalCount,
    successCount: r.successCount,
    successRate: r.totalCount > 0 ? r.successCount / r.totalCount : 0,
  }));
}

async function getConsecutiveFailures(category: TaskCategory, model: string): Promise<number> {
  const recent = await db
    .select({ cliSuccess: taskLogs.cliSuccess, heuristicScore: taskLogs.heuristicScore })
    .from(taskLogs)
    .where(and(eq(taskLogs.taskCategory, category), eq(taskLogs.modelSelected, model)))
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

function selectByComplexity(score: number): ClaudeModel {
  if (score <= COMPLEXITY_TIERS.low.max) return COMPLEXITY_TIERS.low.model;
  if (score <= COMPLEXITY_TIERS.medium.max) return COMPLEXITY_TIERS.medium.model;
  return COMPLEXITY_TIERS.high.model;
}

export type SelectModelResult = {
  decision: RouterDecision;
  category: TaskCategory;
  complexityScore: number;
  classificationLlm?: ClassificationResult["llm"];
};

export async function selectModel(
  requestedModel: string,
  messages: ChatMessage[]
): Promise<SelectModelResult> {
  // 1. If user explicitly requested a Claude model name, respect it
  if (EXPLICIT_CLAUDE_MODELS.has(requestedModel)) {
    const model = MODEL_MAP[requestedModel] ?? DEFAULT_MODEL;
    const classification = await classifyTask(messages);
    return {
      decision: { model, alias: modelAlias(model), reason: `User requested ${requestedModel}` },
      category: classification.category,
      complexityScore: classification.complexityScore,
      classificationLlm: classification.llm,
    };
  }

  // 2. Classify the task
  const classification = await classifyTask(messages);
  const { category, complexityScore, llm: classificationLlm } = classification;

  // 3. Determine the tier-based model (what complexity scoring says to use)
  const tierModel = selectByComplexity(complexityScore);

  // 4. Try to use historical success data
  try {
    const stats = await getSuccessRates(category);
    const hasAnyHistory = stats.length > 0 && stats.some((s) => s.totalCount >= MIN_SAMPLES_FOR_CONFIDENCE);

    if (hasAnyHistory) {
      // Check if cheaper models lack data — if so, explore them sometimes
      const cheaperUntested: ClaudeModel[] = [];
      for (const model of MODEL_COST_ORDER) {
        const modelStats = stats.find((s) => s.model === model);
        if (!modelStats || modelStats.totalCount < MIN_SAMPLES_FOR_CONFIDENCE) {
          // Only explore models at or below the tier-based recommendation
          const modelIndex = MODEL_COST_ORDER.indexOf(model);
          const tierIndex = MODEL_COST_ORDER.indexOf(tierModel);
          if (modelIndex <= tierIndex) {
            cheaperUntested.push(model);
          }
        }
      }

      // Exploration: try an untested cheaper model some % of the time
      if (cheaperUntested.length > 0 && Math.random() < EXPLORE_RATE) {
        const exploreModel = cheaperUntested[0]; // cheapest untested
        return {
          decision: {
            model: exploreModel,
            alias: modelAlias(exploreModel),
            reason: `Explore: trying ${modelAlias(exploreModel)} for ${category} (no history yet, complexity=${complexityScore})`,
          },
          category,
          complexityScore,
          classificationLlm,
        };
      }

      // Normal path: pick cheapest model above threshold that has enough data
      for (const model of MODEL_COST_ORDER) {
        const modelStats = stats.find((s) => s.model === model);

        // Skip if insufficient data for this model
        if (!modelStats || modelStats.totalCount < MIN_SAMPLES_FOR_CONFIDENCE) continue;

        // Skip if below success threshold
        if (modelStats.successRate < SUCCESS_THRESHOLD) continue;

        // Check consecutive failures
        const failures = await getConsecutiveFailures(category, model);
        if (failures >= CONSECUTIVE_FAILURE_LIMIT) continue;

        return {
          decision: {
            model,
            alias: modelAlias(model),
            reason: `Historical: ${modelAlias(model)} has ${Math.round(modelStats.successRate * 100)}% success for ${category} (n=${modelStats.totalCount})`,
          },
          category,
          complexityScore,
          classificationLlm,
        };
      }

      // All models with history failed thresholds — fall through to tier-based
    }
  } catch {
    // DB query failed — fall through to complexity-based routing
  }

  // 5. Fallback: complexity score tiers
  return {
    decision: {
      model: tierModel,
      alias: modelAlias(tierModel),
      reason: `Complexity ${complexityScore} -> ${modelAlias(tierModel)} (tier-based)`,
    },
    category,
    complexityScore,
    classificationLlm,
  };
}
