"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PROVIDER_COLORS, providerLabel } from "@/lib/constants";

interface ProviderStats {
  provider: string;
  totalRequests: number;
  totalCost: number;
  avgLatency: number;
  successRate: number;
  avgTokensIn: number;
  avgTokensOut: number;
}

export function ProviderComparison({ data }: { data: ProviderStats[] }) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Provider Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">No provider data yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider Comparison</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((p) => (
            <div
              key={p.provider}
              className="border rounded-lg p-4 space-y-3"
              style={{ borderLeftColor: PROVIDER_COLORS[p.provider] ?? "#888", borderLeftWidth: 4 }}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{providerLabel(p.provider)}</span>
                <Badge variant="outline" className="text-xs">{p.provider}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-muted-foreground text-xs">Requests</div>
                  <div className="font-mono font-medium">{p.totalRequests}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Total Cost</div>
                  <div className="font-mono font-medium">${(p.totalCost ?? 0).toFixed(4)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Avg Latency</div>
                  <div className="font-mono font-medium">{p.avgLatency ?? 0}ms</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Success Rate</div>
                  <div className="font-mono font-medium">
                    {((p.successRate ?? 0) * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Avg Tokens In</div>
                  <div className="font-mono font-medium">{(p.avgTokensIn ?? 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs">Avg Tokens Out</div>
                  <div className="font-mono font-medium">{(p.avgTokensOut ?? 0).toLocaleString()}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
