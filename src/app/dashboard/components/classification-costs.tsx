"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from "recharts";

interface ClassificationCostData {
  date: string;
  totalCalls: number;
  totalCostUsd: number;
  avgLatencyMs: number;
}

export function ClassificationCosts({ data }: { data: ClassificationCostData[] }) {
  const totalCost = data.reduce((sum, d) => sum + d.totalCostUsd, 0);
  const totalCalls = data.reduce((sum, d) => sum + d.totalCalls, 0);

  const chartData = data.map((d) => ({
    date: d.date.slice(5), // MM-DD
    calls: d.totalCalls,
    cost: d.totalCostUsd,
    latency: d.avgLatencyMs,
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Classification Costs (Haiku)</CardTitle>
          <div className="text-sm text-muted-foreground">
            {totalCalls} calls | ${totalCost.toFixed(4)} total
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No LLM classification data yet. Enable in{" "}
            <Link href="/settings" className="underline text-foreground hover:text-primary">
              Settings &gt; General
            </Link>.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis yAxisId="left" fontSize={12} tickFormatter={(v) => `$${v.toFixed(3)}`} />
              <YAxis yAxisId="right" orientation="right" fontSize={12} tickFormatter={(v) => `${v}ms`} />
              <Tooltip
                formatter={(value, name) => {
                  const v = Number(value);
                  if (name === "cost") return [`$${v.toFixed(4)}`, "Cost"];
                  if (name === "latency") return [`${v}ms`, "Avg Latency"];
                  return [v, "Calls"];
                }}
              />
              <Bar yAxisId="left" dataKey="cost" fill="#10b981" name="cost" radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="latency" stroke="#f59e0b" name="latency" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
