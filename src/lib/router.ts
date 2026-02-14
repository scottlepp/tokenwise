import { db } from "./db";
import { taskLogs } from "./db/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import type { TaskCategory, ClaudeModel, RouterDecision, ChatMessage } from "./types";
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

export async function selectModel(
  requestedModel: string,
  messages: ChatMessage[]
): Promise<{ decision: RouterDecision; category: TaskCategory; complexityScore: number }> {
  // 1. If user explicitly requested a Claude model name, respect it
  if (EXPLICIT_CLAUDE_MODELS.has(requestedModel)) {
    const model = MODEL_MAP[requestedModel] ?? DEFAULT_MODEL;
    const classification = classifyTask(messages);
    return {
      decision: { model, alias: modelAlias(model), reason: `User requested ${requestedModel}` },
      category: classification.category,
      complexityScore: classification.complexityScore,
    };
  }

  // 2. Classify the task
  const { category, complexityScore } = classifyTask(messages);

  // 3. Try to use historical success data
  try {
    const stats = await getSuccessRates(category);

    if (stats.length > 0 && stats.some((s) => s.totalCount >= 3)) {
      // Have enough history — pick cheapest model above threshold
      for (const model of MODEL_COST_ORDER) {
        const modelStats = stats.find((s) => s.model === model);

        // Skip if insufficient data for this model
        if (!modelStats || modelStats.totalCount < 3) continue;

        // Skip if below success threshold
        if (modelStats.successRate < SUCCESS_THRESHOLD) continue;

        // Check consecutive failures
        const failures = await getConsecutiveFailures(category, model);
        if (failures >= CONSECUTIVE_FAILURE_LIMIT) continue;

        return {
          decision: {
            model,
            alias: modelAlias(model),
            reason: `Historical: ${modelAlias(model)} has ${Math.round(modelStats.successRate * 100)}% success rate for ${category} (n=${modelStats.totalCount})`,
          },
          category,
          complexityScore,
        };
      }
    }
  } catch {
    // DB query failed — fall through to complexity-based routing
  }

  // 4. Fallback: complexity score tiers
  const model = selectByComplexity(complexityScore);
  return {
    decision: {
      model,
      alias: modelAlias(model),
      reason: `Complexity score ${complexityScore} → ${modelAlias(model)} (tier-based, no history)`,
    },
    category,
    complexityScore,
  };
}
