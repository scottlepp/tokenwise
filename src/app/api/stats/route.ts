import { NextRequest, NextResponse } from "next/server";
import {
  getCostOverTime,
  getCostByProvider,
  getModelBreakdown,
  getSuccessRates,
  getRequestVolume,
  getLatencyByModel,
  getProviderLatency,
  getProviderComparison,
  getRecentRequests,
  getCostSavings,
  getSummaryStats,
  getCompressionStats,
  getCacheHitRate,
  getBudgetUsage,
  getPipelineStepStats,
  getRequestStatusBreakdown,
  getClassificationCosts,
  getRecentRequestsDetailed,
} from "@/lib/db/queries";

const METRICS: Record<string, (days: number) => Promise<unknown>> = {
  cost_over_time: getCostOverTime,
  cost_by_provider: getCostByProvider,
  model_breakdown: getModelBreakdown,
  success_rates: getSuccessRates,
  request_volume: getRequestVolume,
  latency_by_model: getLatencyByModel,
  provider_latency: getProviderLatency,
  provider_comparison: getProviderComparison,
  cost_savings: getCostSavings,
  summary: getSummaryStats,
  compression: getCompressionStats,
  cache_hit_rate: getCacheHitRate,
  pipeline_steps: getPipelineStepStats,
  request_status: getRequestStatusBreakdown,
  classification_costs: getClassificationCosts,
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const metric = searchParams.get("metric");
  const days = parseInt(searchParams.get("days") ?? "7", 10);

  if (metric === "recent_requests") {
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(searchParams.get("offset") ?? "0", 10);
    const data = await getRecentRequests(limit, offset);
    return NextResponse.json({ data });
  }

  if (metric === "budget") {
    const data = await getBudgetUsage();
    return NextResponse.json({ data });
  }

  if (metric === "all") {
    const results: Record<string, unknown> = {};
    const entries = Object.entries(METRICS);
    const resolved = await Promise.all(entries.map(([, fn]) => fn(days)));
    entries.forEach(([key], i) => {
      results[key] = resolved[i];
    });

    const [recentRequests, recentRequestsDetailed] = await Promise.all([
      getRecentRequests(20, 0),
      getRecentRequestsDetailed(20),
    ]);
    results.recent_requests = recentRequests;
    results.recent_requests_detailed = recentRequestsDetailed;

    const budget = await getBudgetUsage();
    results.budget = budget;

    return NextResponse.json({ data: results });
  }

  if (!metric || !METRICS[metric]) {
    return NextResponse.json(
      { error: { message: `Unknown metric: ${metric}. Available: ${Object.keys(METRICS).join(", ")}, recent_requests, budget, all`, type: "invalid_request_error", code: "invalid_metric" } },
      { status: 400 }
    );
  }

  const data = await METRICS[metric](days);
  return NextResponse.json({ data });
}
