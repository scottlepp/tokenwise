"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { PROVIDER_COLORS, providerLabel } from "@/lib/constants";

interface CostDataPoint {
  date: string;
  provider: string;
  model: string;
  cost: number;
}

export function CostOverTime({ data }: { data: CostDataPoint[] }) {
  // Pivot data: group cost by provider per date
  const dateMap = new Map<string, Record<string, number>>();
  for (const d of data) {
    const existing = dateMap.get(d.date) ?? {};
    const key = d.provider;
    existing[key] = (existing[key] ?? 0) + d.cost;
    dateMap.set(d.date, existing);
  }

  const providers = [...new Set(data.map((d) => d.provider))];
  const chartData = Array.from(dateMap.entries()).map(([date, costs]) => ({
    date,
    ...costs,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Over Time (by Provider)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={12} />
            <YAxis fontSize={12} tickFormatter={(v) => `$${v}`} />
            <Tooltip formatter={(value) => `$${Number(value).toFixed(4)}`} />
            <Legend />
            {providers.map((provider) => (
              <Line
                key={provider}
                type="monotone"
                dataKey={provider}
                name={providerLabel(provider)}
                stroke={PROVIDER_COLORS[provider] ?? "#888"}
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
