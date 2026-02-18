"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface StatusData {
  status: string;
  count: number;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#10b981",
  error: "#ef4444",
  cached: "#8b5cf6",
  deduped: "#6366f1",
  pending: "#f59e0b",
  processing: "#3b82f6",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "#94a3b8";
}

export function RequestStatusBreakdown({ data }: { data: StatusData[] }) {
  const chartData = data
    .filter((d) => d.count > 0)
    .map((d) => ({
      name: d.status,
      value: d.count,
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request Status</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={90}
              paddingAngle={2}
              label={({ name, percent }) => `${name ?? ""} (${((percent ?? 0) * 100).toFixed(1)}%)`}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={statusColor(entry.name)} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => [Number(value), "Requests"]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
