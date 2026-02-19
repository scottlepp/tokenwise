"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CostOverTime } from "../components/cost-over-time";
import { CostSavings } from "../components/cost-savings";
import { BudgetGauges } from "../components/budget-gauges";
import { ClassificationCosts } from "../components/classification-costs";
import { ModelBreakdown } from "../components/model-breakdown";
import { useDashboardData } from "@/hooks/use-dashboard-data";

const METRICS = ["cost_over_time", "cost_savings", "classification_costs", "model_breakdown"];
const EXTRAS = [{ key: "budget", url: "/api/stats?metric=budget" }];

function CostsContent() {
  const searchParams = useSearchParams();
  const days = parseInt(searchParams.get("days") ?? "7", 10);
  const { data, loading } = useDashboardData(METRICS, days, EXTRAS);

  if (loading && Object.keys(data).length === 0) {
    return <div className="text-center py-20 text-muted-foreground">Loading cost data...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Costs & Budget</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <CostOverTime data={data.cost_over_time ?? []} />
        </div>
        <ModelBreakdown data={data.model_breakdown ?? []} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ClassificationCosts data={data.classification_costs ?? []} />
        </div>
        <CostSavings data={data.cost_savings ?? null} />
      </div>

      <BudgetGauges data={data.budget ?? []} />
    </div>
  );
}

export default function CostsPage() {
  return (
    <Suspense fallback={<div className="text-center py-20 text-muted-foreground">Loading...</div>}>
      <CostsContent />
    </Suspense>
  );
}
