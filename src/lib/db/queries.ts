import { db } from ".";
import { taskLogs, requestLogs, statusLogs, budgetConfig, modelsTable } from "./schema";
import { desc, sql, gte, eq, and, inArray } from "drizzle-orm";
import type { TaskLogInsert, RequestLogInsert, StatusLogInsert } from "../types";

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

// ── Request Logs ──

export async function insertRequestLog(data: RequestLogInsert): Promise<string> {
  const [row] = await db.insert(requestLogs).values(data).returning({ id: requestLogs.id });
  return row.id;
}

export async function updateRequestStatus(
  requestId: string,
  status: string,
  extras?: { httpStatus?: number; errorMessage?: string; totalLatencyMs?: number }
) {
  await db.update(requestLogs).set({
    status,
    completedAt: new Date(),
    ...extras,
  }).where(eq(requestLogs.id, requestId));
}

// ── Status Logs ──

export async function insertStatusLog(data: StatusLogInsert) {
  await db.insert(statusLogs).values(data);
}

/** Get all status logs for a request, ordered by time */
export async function getStatusLogsForRequest(requestId: string) {
  return db
    .select()
    .from(statusLogs)
    .where(eq(statusLogs.requestId, requestId))
    .orderBy(statusLogs.createdAt);
}

/** Get recent requests with their status logs (joined) */
export async function getRecentRequestsWithStatus(limit: number) {
  const requests = await db
    .select()
    .from(requestLogs)
    .orderBy(desc(requestLogs.createdAt))
    .limit(limit);

  if (requests.length === 0) return [];

  const requestIds = requests.map((r) => r.id);
  const statuses = await db
    .select()
    .from(statusLogs)
    .where(inArray(statusLogs.requestId, requestIds))
    .orderBy(statusLogs.createdAt);

  const statusMap = new Map<string, typeof statuses>();
  for (const s of statuses) {
    const list = statusMap.get(s.requestId) ?? [];
    list.push(s);
    statusMap.set(s.requestId, list);
  }

  return requests.map((r) => ({
    ...r,
    steps: statusMap.get(r.id) ?? [],
  }));
}

/** Get a request with its task log and all status logs */
export async function getRequestDetail(requestId: string) {
  const [request] = await db
    .select()
    .from(requestLogs)
    .where(eq(requestLogs.id, requestId))
    .limit(1);
  if (!request) return null;

  const steps = await getStatusLogsForRequest(requestId);
  const [task] = await db
    .select()
    .from(taskLogs)
    .where(eq(taskLogs.requestId, requestId))
    .limit(1);

  return { request, steps, task: task ?? null };
}

// ── Task Logs ──

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


/** Get the most recent task logs for the activity feed, including requestId for step lookup */
export async function getRecentTaskLogs(limit: number) {
  return db
    .select({
      id: taskLogs.id,
      createdAt: taskLogs.createdAt,
      requestId: taskLogs.requestId,
      provider: taskLogs.provider,
      modelSelected: taskLogs.modelSelected,
      taskCategory: taskLogs.taskCategory,
      complexityScore: taskLogs.complexityScore,
      tokensIn: taskLogs.tokensIn,
      tokensOut: taskLogs.tokensOut,
      costUsd: taskLogs.costUsd,
      latencyMs: taskLogs.latencyMs,
      streaming: taskLogs.streaming,
      cliSuccess: taskLogs.cliSuccess,
      heuristicScore: taskLogs.heuristicScore,
      userRating: taskLogs.userRating,
      promptSummary: taskLogs.promptSummary,
      promptText: taskLogs.promptText,
      responseText: taskLogs.responseText,
      dispatchMode: taskLogs.dispatchMode,
    })
    .from(taskLogs)
    .orderBy(desc(taskLogs.createdAt))
    .limit(limit);
}

/** Get recent task logs with their pipeline steps and request metadata for the activity feed */
export async function getActivityFeed(limit: number) {
  const tasks = await getRecentTaskLogs(limit);
  if (tasks.length === 0) return [];

  const requestIds = tasks.map((t) => t.requestId).filter(Boolean) as string[];

  const [steps, requests] = await Promise.all([
    requestIds.length > 0
      ? db
          .select()
          .from(statusLogs)
          .where(inArray(statusLogs.requestId, requestIds))
          .orderBy(statusLogs.createdAt)
      : Promise.resolve([]),
    requestIds.length > 0
      ? db
          .select({
            id: requestLogs.id,
            status: requestLogs.status,
            promptPreview: requestLogs.promptPreview,
            messageCount: requestLogs.messageCount,
            toolCount: requestLogs.toolCount,
            totalLatencyMs: requestLogs.totalLatencyMs,
            userAgent: requestLogs.userAgent,
          })
          .from(requestLogs)
          .where(inArray(requestLogs.id, requestIds))
      : Promise.resolve([]),
  ]);

  const stepMap = new Map<string, typeof steps>();
  for (const s of steps) {
    const list = stepMap.get(s.requestId) ?? [];
    list.push(s);
    stepMap.set(s.requestId, list);
  }

  const requestMap = new Map<string, typeof requests[0]>();
  for (const r of requests) requestMap.set(r.id, r);

  return tasks.map((t) => ({
    ...t,
    steps: t.requestId ? (stepMap.get(t.requestId) ?? []) : [],
    request: t.requestId ? (requestMap.get(t.requestId) ?? null) : null,
  }));
}

export async function getCostOverTime(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      date: sql<string>`date_trunc('day', ${taskLogs.createdAt})::date::text`,
      provider: taskLogs.provider,
      model: taskLogs.modelSelected,
      cost: sql<number>`sum(${taskLogs.costUsd})::float`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`, taskLogs.provider, taskLogs.modelSelected)
    .orderBy(sql`date_trunc('day', ${taskLogs.createdAt})::date`);
}

export async function getCostByProvider(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      provider: taskLogs.provider,
      cost: sql<number>`sum(${taskLogs.costUsd})::float`,
      requests: sql<number>`count(*)::int`,
      avgLatency: sql<number>`avg(${taskLogs.latencyMs})::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(taskLogs.provider);
}

export async function getModelBreakdown(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      provider: taskLogs.provider,
      model: taskLogs.modelSelected,
      count: sql<number>`count(*)::int`,
      cost: sql<number>`sum(${taskLogs.costUsd})::float`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(taskLogs.provider, taskLogs.modelSelected);
}

export async function getSuccessRates(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      provider: taskLogs.provider,
      model: taskLogs.modelSelected,
      category: taskLogs.taskCategory,
      total: sql<number>`count(*)::int`,
      successes: sql<number>`count(*) filter (where ${taskLogs.cliSuccess} = true and (${taskLogs.heuristicScore} is null or ${taskLogs.heuristicScore} >= 40))::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(taskLogs.provider, taskLogs.modelSelected, taskLogs.taskCategory);
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
      provider: taskLogs.provider,
      model: taskLogs.modelSelected,
      avgLatency: sql<number>`avg(${taskLogs.latencyMs})::int`,
      p50: sql<number>`percentile_cont(0.5) within group (order by ${taskLogs.latencyMs})::int`,
      p95: sql<number>`percentile_cont(0.95) within group (order by ${taskLogs.latencyMs})::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(taskLogs.provider, taskLogs.modelSelected);
}

export async function getProviderLatency(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      provider: taskLogs.provider,
      avgLatency: sql<number>`avg(${taskLogs.latencyMs})::int`,
      p50: sql<number>`percentile_cont(0.5) within group (order by ${taskLogs.latencyMs})::int`,
      p95: sql<number>`percentile_cont(0.95) within group (order by ${taskLogs.latencyMs})::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(taskLogs.provider);
}

export async function getProviderComparison(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      provider: taskLogs.provider,
      totalRequests: sql<number>`count(*)::int`,
      totalCost: sql<number>`sum(${taskLogs.costUsd})::float`,
      avgLatency: sql<number>`avg(${taskLogs.latencyMs})::int`,
      successRate: sql<number>`(count(*) filter (where ${taskLogs.cliSuccess} = true and (${taskLogs.heuristicScore} is null or ${taskLogs.heuristicScore} >= 40)))::float / nullif(count(*), 0)`,
      avgTokensIn: sql<number>`avg(${taskLogs.tokensIn})::int`,
      avgTokensOut: sql<number>`avg(${taskLogs.tokensOut})::int`,
    })
    .from(taskLogs)
    .where(gte(taskLogs.createdAt, since))
    .groupBy(taskLogs.provider);
}

export async function getRecentRequests(limit: number, offset: number) {
  return db
    .select({
      id: taskLogs.id,
      createdAt: taskLogs.createdAt,
      requestId: taskLogs.requestId,
      taskCategory: taskLogs.taskCategory,
      complexityScore: taskLogs.complexityScore,
      promptSummary: taskLogs.promptSummary,
      messageCount: taskLogs.messageCount,
      provider: taskLogs.provider,
      modelRequested: taskLogs.modelRequested,
      modelSelected: taskLogs.modelSelected,
      modelDisplayName: modelsTable.displayName,
      routerReason: taskLogs.routerReason,
      tokensIn: taskLogs.tokensIn,
      tokensOut: taskLogs.tokensOut,
      costUsd: taskLogs.costUsd,
      latencyMs: taskLogs.latencyMs,
      streaming: taskLogs.streaming,
      tokensBeforeCompression: taskLogs.tokensBeforeCompression,
      tokensAfterCompression: taskLogs.tokensAfterCompression,
      cacheHit: taskLogs.cacheHit,
      budgetRemainingUsd: taskLogs.budgetRemainingUsd,
      dispatchMode: taskLogs.dispatchMode,
      cliSuccess: taskLogs.cliSuccess,
      heuristicScore: taskLogs.heuristicScore,
      userRating: taskLogs.userRating,
      errorMessage: taskLogs.errorMessage,
    })
    .from(taskLogs)
    .leftJoin(
      modelsTable,
      and(
        eq(modelsTable.providerId, taskLogs.provider),
        eq(modelsTable.modelId, taskLogs.modelSelected)
      )
    )
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
      providersActive: sql<number>`count(distinct ${taskLogs.provider})::int`,
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

// ── Pipeline & Request Stats (from request_logs + status_logs) ──

/** Average duration per pipeline step */
export async function getPipelineStepStats(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      step: statusLogs.step,
      avgDurationMs: sql<number>`avg(${statusLogs.durationMs})::int`,
      p50: sql<number>`percentile_cont(0.5) within group (order by ${statusLogs.durationMs})::int`,
      p95: sql<number>`percentile_cont(0.95) within group (order by ${statusLogs.durationMs})::int`,
      count: sql<number>`count(*)::int`,
      errorCount: sql<number>`count(*) filter (where ${statusLogs.status} = 'error')::int`,
    })
    .from(statusLogs)
    .where(gte(statusLogs.createdAt, since))
    .groupBy(statusLogs.step);
}

/** Request status breakdown (completed, error, cached, deduped, etc.) */
export async function getRequestStatusBreakdown(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      status: requestLogs.status,
      count: sql<number>`count(*)::int`,
    })
    .from(requestLogs)
    .where(gte(requestLogs.createdAt, since))
    .groupBy(requestLogs.status);
}

/** Classification cost tracking — extracts LLM classifier costs from status_logs detail JSON */
export async function getClassificationCosts(days: number) {
  const since = daysAgo(days);
  return db
    .select({
      date: sql<string>`date_trunc('day', ${statusLogs.createdAt})::date::text`,
      totalCalls: sql<number>`count(*)::int`,
      totalCostUsd: sql<number>`coalesce(sum((${statusLogs.detail}::jsonb->>'classifierCostUsd')::float), 0)::float`,
      avgLatencyMs: sql<number>`avg((${statusLogs.detail}::jsonb->>'classifierLatencyMs')::float)::int`,
    })
    .from(statusLogs)
    .where(
      and(
        gte(statusLogs.createdAt, since),
        eq(statusLogs.step, "classify"),
        sql`jsonb_exists(${statusLogs.detail}::jsonb, 'classifierCostUsd')`
      )
    )
    .groupBy(sql`date_trunc('day', ${statusLogs.createdAt})::date`)
    .orderBy(sql`date_trunc('day', ${statusLogs.createdAt})::date`);
}

/** Recent requests from request_logs with joined pipeline steps and task info */
export async function getRecentRequestsDetailed(limit: number) {
  const requests = await db
    .select()
    .from(requestLogs)
    .orderBy(desc(requestLogs.createdAt))
    .limit(limit);

  if (requests.length === 0) return [];

  const requestIds = requests.map((r) => r.id);

  const [statuses, tasks] = await Promise.all([
    db
      .select()
      .from(statusLogs)
      .where(inArray(statusLogs.requestId, requestIds))
      .orderBy(statusLogs.createdAt),
    db
      .select()
      .from(taskLogs)
      .where(inArray(taskLogs.requestId, requestIds)),
  ]);

  const statusMap = new Map<string, typeof statuses>();
  for (const s of statuses) {
    const list = statusMap.get(s.requestId) ?? [];
    list.push(s);
    statusMap.set(s.requestId, list);
  }

  const taskMap = new Map<string, (typeof tasks)[0]>();
  for (const t of tasks) {
    if (t.requestId) taskMap.set(t.requestId, t);
  }

  return requests.map((r) => ({
    ...r,
    steps: statusMap.get(r.id) ?? [],
    task: taskMap.get(r.id) ?? null,
  }));
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
