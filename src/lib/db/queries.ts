import { db } from ".";
import { taskLogs, budgetConfig } from "./schema";
import { desc, sql, gte, eq } from "drizzle-orm";
import type { TaskLogInsert } from "../types";

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export async function insertTaskLog(data: TaskLogInsert) {
  const [row] = await db.insert(taskLogs).values(data).returning({ id: taskLogs.id });
  return row.id;
}

export async function updateUserRating(taskId: string, rating: number) {
  await db.update(taskLogs).set({ userRating: rating }).where(eq(taskLogs.id, taskId));
}

export async function getMostRecentTaskId(): Promise<string | null> {
  const [row] = await db
    .select({ id: taskLogs.id })
    .from(taskLogs)
    .orderBy(desc(taskLogs.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export async function getTaskById(taskId: string) {
  const [row] = await db.select().from(taskLogs).where(eq(taskLogs.id, taskId)).limit(1);
  return row ?? null;
}

export async function findTaskByPartialId(partialId: string) {
  const rows = await db
    .select()
    .from(taskLogs)
    .where(sql`${taskLogs.id}::text like ${partialId + "%"}`)
    .orderBy(desc(taskLogs.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCostOverTime(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      date: sql<string>`date_trunc('day', ${taskLogs.createdAt})::date::text`,
      model: taskLogs.modelSelected,
      cost: sql<number>`sum(${taskLogs.costUsd})::float`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`, taskLogs.modelSelected)
    .orderBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`);
}

export async function getModelBreakdown(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      model: taskLogs.modelSelected,
      count: sql<number>`count(*)::int`,
      cost: sql<number>`sum(${taskLogs.costUsd})::float`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(taskLogs.modelSelected);
}

export async function getSuccessRates(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      model: taskLogs.modelSelected,
      category: taskLogs.taskCategory,
      total: sql<number>`count(*)::int`,
      successes: sql<number>`count(*) filter (where ${taskLogs.cliSuccess} = true and (${taskLogs.heuristicScore} is null or ${taskLogs.heuristicScore} >= 40))::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(taskLogs.modelSelected, taskLogs.taskCategory);
}

export async function getRequestVolume(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      date: sql<string>`date_trunc('day', ${taskLogs.createdAt})::date::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`)
    .orderBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`);
}

export async function getLatencyByModel(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      model: taskLogs.modelSelected,
      avgLatency: sql<number>`avg(${taskLogs.latencyMs})::int`,
      p50: sql<number>`percentile_cont(0.5) within group (order by ${taskLogs.latencyMs})::int`,
      p95: sql<number>`percentile_cont(0.95) within group (order by ${taskLogs.latencyMs})::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(taskLogs.modelSelected);
}

export async function getRecentRequests(limit: number, offset: number) {
  return db
    .select()
    .from(taskLogs)
    .orderBy(desc(taskLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getCostSavings(days: number) {
  const since = daysAgo(days);
  const [row] = await db
    .select({
      actualCost: sql<number>`sum(${taskLogs.costUsd})::float`,
      opusCost: sql<number>`sum((${taskLogs.tokensIn} * 15.0 + ${taskLogs.tokensOut} * 75.0) / 1000000.0)::float`,
      totalRequests: sql<number>`count(*)::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since));
  return row;
}

export async function getSummaryStats(days: number) {
  const since = daysAgo(days);
  const [row] = await db
    .select({
      totalRequests: sql<number>`count(*)::int`,
      totalCost: sql<number>`sum(${taskLogs.costUsd})::float`,
      avgLatency: sql<number>`avg(${taskLogs.latencyMs})::int`,
      successRate: sql<number>`(count(*) filter (where ${taskLogs.cliSuccess} = true and (${taskLogs.heuristicScore} is null or ${taskLogs.heuristicScore} >= 40)))::float / nullif(count(*), 0)`,
      totalTokensSaved: sql<number>`sum(coalesce(${taskLogs.tokensBeforeCompression}, 0) - coalesce(${taskLogs.tokensAfterCompression}, 0))::int`,
      cacheHits: sql<number>`count(*) filter (where ${taskLogs.cacheHit} = true)::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since));
  return row;
}

export async function getCompressionStats(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      date: sql<string>`date_trunc('day', ${taskLogs.createdAt})::date::text`,
      tokensBefore: sql<number>`sum(coalesce(${taskLogs.tokensBeforeCompression}, 0))::int`,
      tokensAfter: sql<number>`sum(coalesce(${taskLogs.tokensAfterCompression}, 0))::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`)
    .orderBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`);
}

export async function getCacheHitRate(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      date: sql<string>`date_trunc('day', ${taskLogs.createdAt})::date::text`,
      total: sql<number>`count(*)::int`,
      hits: sql<number>`count(*) filter (where ${taskLogs.cacheHit} = true)::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`)
    .orderBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`);
}

export async function getBudgetUsage() {
  const configs = await db.select().from(budgetConfig).where(eq(budgetConfig.enabled, true));
  const results = [];

  for (const config of configs) {
    let since: Date;
    const now = new Date();
    if (config.period === "daily") {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (config.period === "weekly") {
      const dayOfWeek = now.getDay();
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
    } else {
      since = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const [row] = await db
      .select({ spent: sql<number>`coalesce(sum(${taskLogs.costUsd}), 0)::float` })
      .from(taskLogs)
      .where(gte(taskLogs.createdAt, since));

    results.push({
      period: config.period,
      limitUsd: parseFloat(config.limitUsd),
      spentUsd: row?.spent ?? 0,
      percentUsed: row?.spent ? (row.spent / parseFloat(config.limitUsd)) * 100 : 0,
    });
  }

  return results;
}
