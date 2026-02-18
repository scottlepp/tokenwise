"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface CacheHitDataPoint {
  date: string;
  total: number;
  hits: number;
}

export function CacheHitRate({ data }: { data: CacheHitDataPoint[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tooltipFormatter: any = (value: number | string | (number | string)[], name: string) => {
    if (name === "rate") return [`${value}%`, "Hit Rate"];
    return [value, name];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tooltipLabelFormatter: any = (label: string) => `Date: ${label}`;

  const chartData = data.map((d) => ({
    date: d.date,
    rate: d.total > 0 ? Math.round((d.hits / d.total) * 100) : 0,
    hits: d.hits,
    total: d.total,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cache Hit Rate</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">No cache data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                formatter={tooltipFormatter}
                labelFormatter={tooltipLabelFormatter}
              />
              <Line
                type="monotone"
                dataKey="rate"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3 }}
                name="rate"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}