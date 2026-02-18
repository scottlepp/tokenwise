"use client";

import { useEffect, useState, useCallback } from "react";
import { StatsCards } from "./components/stats-cards";
import { CostOverTime } from "./components/cost-over-time";
import { ModelBreakdown } from "./components/model-breakdown";
import { SuccessRates } from "./components/success-rates";
import { RequestVolume } from "./components/request-volume";
import { LatencyChart } from "./components/latency-chart";
import { CostSavings } from "./components/cost-savings";
import { CompressionStats } from "./components/compression-stats";
import { CacheHitRate } from "./components/cache-hit-rate";
import { BudgetGauges } from "./components/budget-gauges";
import { PipelineSteps } from "./components/pipeline-steps";
import { RequestStatusBreakdown } from "./components/request-status-breakdown";
import { ClassificationCosts } from "./components/classification-costs";
import { RecentRequests } from "./components/recent-requests";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function DashboardPage() {
  const [days, setDays] = useState("7");
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/stats?metric=all&days=${days}`);
      const json = await res.json();
      setData(json.data);
    } catch (err) {
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-6 px-4 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Claude Proxy Dashboard</h1>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24h</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading && !data ? (
          <div className="text-center py-20 text-muted-foreground">Loading dashboard data...</div>
        ) : (
          <>
            <StatsCards data={data?.summary ?? null} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <CostOverTime data={data?.cost_over_time ?? []} />
              </div>
              <ModelBreakdown data={data?.model_breakdown ?? []} />
            </div>

            <SuccessRates data={data?.success_rates ?? []} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RequestVolume data={data?.request_volume ?? []} />
              <LatencyChart data={data?.latency_by_model ?? []} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <CompressionStats data={data?.compression ?? []} />
              </div>
              <CostSavings data={data?.cost_savings ?? null} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <CacheHitRate data={data?.cache_hit_rate ?? []} />
              <BudgetGauges data={data?.budget ?? []} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <PipelineSteps data={data?.pipeline_steps ?? []} />
              </div>
              <RequestStatusBreakdown data={data?.request_status ?? []} />
            </div>

            <ClassificationCosts data={data?.classification_costs ?? []} />

            <RecentRequests
              data={data?.recent_requests ?? []}
              detailed={data?.recent_requests_detailed ?? undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}