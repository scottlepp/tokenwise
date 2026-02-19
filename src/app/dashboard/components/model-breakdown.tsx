"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { PROVIDER_COLORS, FALLBACK_COLORS, providerLabel, shortModelLabel } from "@/lib/constants";

interface ModelData {
  provider: string;
  model: string;
  count: number;
  cost: number;
}

export function ModelBreakdown({ data }: { data: ModelData[] }) {
  const chartData = data.map((d, i) => ({
    name: `${providerLabel(d.provider)} / ${shortModelLabel(d.model)}`,
    value: d.count,
    cost: d.cost,
    color: PROVIDER_COLORS[d.provider] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value, name, props) => [
              `${value} requests ($${(props.payload.cost ?? 0).toFixed(4)})`,
              String(name),
            ]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
