"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface BudgetItem {
  period: string;
  limitUsd: number;
  spentUsd: number;
  percentUsed: number;
}

function GaugeBar({ item }: { item: BudgetItem }) {
  const pct = Math.min(item.percentUsed, 100);
  const color =
    pct >= 100
      ? "bg-red-500"
      : pct >= 80
        ? "bg-yellow-500"
        : "bg-green-500";
  const label = item.period.charAt(0).toUpperCase() + item.period.slice(1);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          ${item.spentUsd.toFixed(2)} / ${item.limitUsd.toFixed(2)}
        </span>
      </div>
      <div className="h-4 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground text-right">
        {pct.toFixed(1)}% used
      </div>
    </div>
  );
}

export function BudgetGauges({ data }: { data: BudgetItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget Usage</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">
            No budget configured. Use the API to set limits.
          </div>
        ) : (
          <div className="space-y-4">
            {data.map((item) => (
              <GaugeBar key={item.period} item={item} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}