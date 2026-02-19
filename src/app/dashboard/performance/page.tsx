"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SuccessRates } from "../components/success-rates";
import { LatencyChart } from "../components/latency-chart";
import { PipelineSteps } from "../components/pipeline-steps";
import { RequestStatusBreakdown } from "../components/request-status-breakdown";
import { CompressionStats } from "../components/compression-stats";
import { CacheHitRate } from "../components/cache-hit-rate";
import { useDashboardData } from "@/hooks/use-dashboard-data";

const METRICS = [
  "success_rates",
  "latency_by_model",
  "pipeline_steps",
  "request_status",
  "compression",
  "cache_hit_rate",
];

function PerformanceContent() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get("days") ?? "7", 10);
  const { data, loading } = useDashboardData(METRICS, days);

  if (loading && Object.keys(data).length === 0) {
    return <div className="text-center py-20 text-muted-foreground">Loading performance data...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Performance</h1>

      <SuccessRates data={data.success_rates ?? []} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LatencyChart data={data.latency_by_model ?? []} />
        <CacheHitRate data={data.cache_hit_rate ?? []} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <PipelineSteps data={data.pipeline_steps ?? []} />
        </div>
        <RequestStatusBreakdown data={data.request_status ?? []} />
      </div>

      <CompressionStats data={data.compression ?? []} />
    </div>
  );
}

export default function PerformancePage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-muted-foreground">Loading...</div>}>
      <PerformanceContent />
    </Suspense>
  );
}
