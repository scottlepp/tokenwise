import { db } from "./db";
import { taskLogs, budgetConfig } from "./db/schema";
import { eq, gte, sql } from "drizzle-orm";

interface BudgetCheckResult {
  allowed: boolean;
  downgrade: boolean;
  reason: string;
  remainingUsd: number;
}

function periodStart(period: string): Date {
  const now = new Date();
  if (period === "daily") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === "weekly") {
    const dayOfWeek = now.getDay();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
  } else {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
}

export async function checkBudget(): Promise<BudgetCheckResult> {
  try {
    const configs = await db.select().from(budgetConfig).where(eq(budgetConfig.enabled, true));

    if (configs.length === 0) {
      return { allowed: true, downgrade: false, reason: "No budget configured", remainingUsd: Infinity };
    }

    for (const config of configs) {
      const since = periodStart(config.period);
      const [row] = await db
        .select({ spent: sql<number>`coalesce(sum(${taskLogs.costUsd}), 0)::float` })
        .from(taskLogs)
        .where(gte(taskLogs.createdAt, since));

      const spent = row?.spent ?? 0;
      const limit = parseFloat(config.limitUsd);
      const percentUsed = (spent / limit) * 100;
      const remaining = Math.max(0, limit - spent);

      if (percentUsed >= 100) {
        return {
          allowed: false,
          downgrade: false,
          reason: `${config.period} budget exceeded: $${spent.toFixed(2)} / $${limit.toFixed(2)}`,
          remainingUsd: 0,
        };
      }

      if (percentUsed >= 80) {
        return {
          allowed: true,
          downgrade: true,
          reason: `${config.period} budget at ${percentUsed.toFixed(0)}%: $${spent.toFixed(2)} / $${limit.toFixed(2)} — downgrading model`,
          remainingUsd: remaining,
        };
      }
    }

    return { allowed: true, downgrade: false, reason: "Within budget", remainingUsd: Infinity };
  } catch {
    // If budget check fails, allow the request
    return { allowed: true, downgrade: false, reason: "Budget check failed, allowing", remainingUsd: Infinity };
  }
}

export function downgradeModel(model: string): string {
  if (model === "claude-opus-4-6") return "claude-sonnet-4-5-20250929";
  if (model === "claude-sonnet-4-5-20250929") return "claude-haiku-4-5-20251001";
  return model; // haiku stays haiku
}
