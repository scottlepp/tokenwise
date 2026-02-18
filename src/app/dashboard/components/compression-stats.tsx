"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface CompressionDataPoint {
  date: string;
  tokensBefore: number;
  tokensAfter: number;
}

export function CompressionStats({ data }: { data: CompressionDataPoint[] }) {
  const chartData = data.map((d) => ({
    date: d.date,
    saved: Math.max(0, (d.tokensBefore ?? 0) - (d.tokensAfter ?? 0)),
    after: d.tokensAfter ?? 0,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compression — Tokens Saved Per Day</CardTitle>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">No compression data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value: number | undefined) => `${(value ?? 0).toLocaleString()} tokens`} />
              <Legend />
              <Bar dataKey="after" stackId="a" fill="#3b82f6" name="Tokens sent" />
              <Bar dataKey="saved" stackId="a" fill="#10b981" name="Tokens saved" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}