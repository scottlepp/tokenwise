"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface PipelineStepData {
  step: string;
  avgDurationMs: number;
  p50: number;
  p95: number;
  count: number;
  errorCount: number;
}

const STEP_ORDER = [
  "parse", "feedback", "dedup", "classify", "route", "budget_check",
  "cache_check", "compress", "cli_spawn", "cli_streaming", "cli_done",
  "tool_parse", "response_sent", "log_task",
];

function stepLabel(step: string): string {
  return step.replace(/_/g, " ").replace(/\bcli\b/g, "CLI");
}

export function PipelineSteps({ data }: { data: PipelineStepData[] }) {
  const sorted = [...data].sort(
    (a, b) => (STEP_ORDER.indexOf(a.step) ?? 99) - (STEP_ORDER.indexOf(b.step) ?? 99)
  );

  const chartData = sorted
    .filter((d) => d.avgDurationMs != null && d.avgDurationMs > 0)
    .map((d) => ({
      name: stepLabel(d.step),
      avg: d.avgDurationMs ?? 0,
      p50: d.p50 ?? 0,
      p95: d.p95 ?? 0,
      count: d.count,
      errors: d.errorCount,
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline Step Latency</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" fontSize={12} tickFormatter={(v) => `${v}ms`} />
            <YAxis type="category" dataKey="name" fontSize={11} width={80} />
            <Tooltip
              formatter={(value, name) => [`${value}ms`, name]}
              labelFormatter={(label) => `Step: ${label}`}
            />
            <Legend />
            <Bar dataKey="avg" fill="#3b82f6" name="Avg" radius={[0, 4, 4, 0]} />
            <Bar dataKey="p95" fill="#f59e0b" name="P95" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
          {sorted.map((d) => (
            <div key={d.step} className="flex justify-between">
              <span>{stepLabel(d.step)}</span>
              <span className="font-mono">
                {d.count}x
                {d.errorCount > 0 && (
                  <span className="text-red-500 ml-1">({d.errorCount} err)</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
