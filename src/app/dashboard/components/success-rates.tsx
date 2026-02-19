"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { providerShortLabel, shortModelLabel } from "@/lib/constants";

interface SuccessData {
  provider: string;
  model: string;
  category: string;
  total: number;
  successes: number;
}

export function SuccessRates({ data }: { data: SuccessData[] }) {
  // Group by provider+model
  const byModel = new Map<string, { total: number; successes: number }>();
  for (const d of data) {
    const key = `${providerShortLabel(d.provider)}/${shortModelLabel(d.model)}`;
    const existing = byModel.get(key) ?? { total: 0, successes: 0 };
    existing.total += d.total;
    existing.successes += d.successes;
    byModel.set(key, existing);
  }

  const modelChart = Array.from(byModel.entries()).map(([name, stats]) => ({
    name,
    rate: stats.total > 0 ? Math.round((stats.successes / stats.total) * 100) : 0,
  }));

  // Group by category
  const byCategory = new Map<string, { total: number; successes: number }>();
  for (const d of data) {
    const existing = byCategory.get(d.category) ?? { total: 0, successes: 0 };
    existing.total += d.total;
    existing.successes += d.successes;
    byCategory.set(d.category, existing);
  }

  const categoryChart = Array.from(byCategory.entries()).map(([category, stats]) => ({
    name: category,
    rate: stats.total > 0 ? Math.round((stats.successes / stats.total) * 100) : 0,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Success Rate by Provider/Model</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={modelChart} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" width={100} fontSize={11} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Bar dataKey="rate" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Success Rate by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={categoryChart} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <YAxis type="category" dataKey="name" width={80} fontSize={12} />
              <Tooltip formatter={(value) => `${value}%`} />
              <Bar dataKey="rate" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
