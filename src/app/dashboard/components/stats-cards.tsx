"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface SummaryStats {
  totalRequests: number;
  totalCost: number;
  avgLatency: number;
  successRate: number;
  totalTokensSaved: number;
  cacheHits: number;
  providersActive: number;
}

export function StatsCards({ data }: { data: SummaryStats | null }) {
  if (!data) return null;

  const cards = [
    { title: "Total Requests", value: data.totalRequests?.toLocaleString() ?? "0" },
    { title: "Total Cost", value: `$${(data.totalCost ?? 0).toFixed(4)}` },
    { title: "Avg Latency", value: `${(data.avgLatency ?? 0).toLocaleString()}ms` },
    { title: "Success Rate", value: `${((data.successRate ?? 0) * 100).toFixed(1)}%` },
    { title: "Providers Active", value: (data.providersActive ?? 0).toLocaleString() },
    { title: "Tokens Saved", value: (data.totalTokensSaved ?? 0).toLocaleString() },
    { title: "Cache Hits", value: (data.cacheHits ?? 0).toLocaleString() },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
