"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { StatsCards } from "./components/stats-cards";
import { CostOverTime } from "./components/cost-over-time";
import { ProviderComparison } from "./components/provider-comparison";
import { RequestVolume } from "./components/request-volume";
import { useDashboardData } from "@/hooks/use-dashboard-data";

const METRICS = ["summary", "provider_comparison", "cost_over_time", "request_volume"];

function OverviewContent() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get("days") ?? "7", 10);
  const { data, loading } = useDashboardData(METRICS, days);

  if (loading && Object.keys(data).length === 0) {
    return <div className="text-center py-20 text-muted-foreground">Loading dashboard data...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Overview</h1>

      <StatsCards data={data.summary ?? null} />

      <ProviderComparison data={data.provider_comparison ?? []} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CostOverTime data={data.cost_over_time ?? []} />
        <RequestVolume data={data.request_volume ?? []} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-muted-foreground">Loading...</div>}>
      <OverviewContent />
    </Suspense>
  );
}
