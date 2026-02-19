"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { providerShortLabel, shortModelLabel } from "@/lib/constants";

interface LatencyData {
  provider: string;
  model: string;
  avgLatency: number;
  p50: number;
  p95: number;
}

export function LatencyChart({ data }: { data: LatencyData[] }) {
  const chartData = data.map((d) => ({
    name: `${providerShortLabel(d.provider)}/${shortModelLabel(d.model)}`,
    avg: d.avgLatency,
    p50: d.p50,
    p95: d.p95,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Latency by Provider/Model</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" fontSize={11} />
            <YAxis fontSize={12} tickFormatter={(v) => `${v}ms`} />
            <Tooltip formatter={(value) => `${value}ms`} />
            <Legend />
            <Bar dataKey="avg" fill="#3b82f6" name="Avg" radius={[4, 4, 0, 0]} />
            <Bar dataKey="p50" fill="#10b981" name="P50" radius={[4, 4, 0, 0]} />
            <Bar dataKey="p95" fill="#f59e0b" name="P95" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
