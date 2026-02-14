"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SavingsData {
  actualCost: number;
  opusCost: number;
  totalRequests: number;
}

export function CostSavings({ data }: { data: SavingsData | null }) {
  if (!data) return null;

  const saved = (data.opusCost ?? 0) - (data.actualCost ?? 0);
  const pctSaved = data.opusCost > 0 ? (saved / data.opusCost) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Savings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Actual cost</span>
          <span className="font-mono font-bold">${(data.actualCost ?? 0).toFixed(4)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">If all Opus</span>
          <span className="font-mono text-muted-foreground">${(data.opusCost ?? 0).toFixed(4)}</span>
        </div>
        <hr />
        <div className="flex justify-between">
          <span className="font-medium text-green-600">Saved</span>
          <span className="font-mono font-bold text-green-600">
            ${saved.toFixed(4)} ({pctSaved.toFixed(0)}%)
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Based on {data.totalRequests ?? 0} requests
        </p>
      </CardContent>
    </Card>
  );
}
