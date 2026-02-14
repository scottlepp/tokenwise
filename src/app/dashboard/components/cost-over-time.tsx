"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface CostDataPoint {
  date: string;
  model: string;
  cost: number;
}

const MODEL_COLORS: Record<string, string> = {
  "claude-opus-4-6": "#8b5cf6",
  "claude-sonnet-4-5-20250929": "#3b82f6",
  "claude-haiku-4-5-20251001": "#10b981",
};

export function CostOverTime({ data }: { data: CostDataPoint[] }) {
  // Pivot data: each date gets a row with model costs as columns
  const dateMap = new Map<string, Record<string, number>>();
  for (const d of data) {
    const existing = dateMap.get(d.date) ?? {};
    existing[d.model] = (existing[d.model] ?? 0) + d.cost;
    dateMap.set(d.date, existing);
  }

  const models = [...new Set(data.map((d) => d.model))];
  const chartData = Array.from(dateMap.entries()).map(([date, costs]) => ({
    date,
    ...costs,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Over Time</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={12} />
            <YAxis fontSize={12} tickFormatter={(v) => `$${v}`} />
            <Tooltip formatter={(value) => `$${Number(value).toFixed(4)}`} />
            <Legend />
            {models.map((model) => (
              <Line
                key={model}
                type="monotone"
                dataKey={model}
                stroke={MODEL_COLORS[model] ?? "#888"}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
