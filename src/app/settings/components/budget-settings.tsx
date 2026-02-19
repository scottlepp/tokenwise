"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface BudgetRow {
  period: string;
  limitUsd: string;
  enabled: boolean;
}

const PERIODS = ["daily", "weekly", "monthly"] as const;

export function BudgetSettings() {
  const [configs, setConfigs] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function fetchBudget() {
    const res = await fetch("/api/budget");
    const json = await res.json();
    setConfigs(json.configs ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchBudget();
  }, []);

  function getConfig(period: string): BudgetRow {
    return configs.find((c) => c.period === period) ?? { period, limitUsd: "0", enabled: false };
  }

  function updateLocal(period: string, updates: Partial<BudgetRow>) {
    setConfigs((prev) => {
      const existing = prev.find((c) => c.period === period);
      if (existing) {
        return prev.map((c) => c.period === period ? { ...c, ...updates } : c);
      }
      return [...prev, { period, limitUsd: "0", enabled: false, ...updates }];
    });
  }

  async function save(period: string) {
    const config = getConfig(period);
    setSaving(period);
    await fetch("/api/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period,
        limitUsd: parseFloat(config.limitUsd) || 1,
        enabled: config.enabled,
      }),
    });
    setSaving(null);
    fetchBudget();
  }

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground">Loading budget config...</div>;
  }

  return (
    <div className="space-y-4">
      {PERIODS.map((period) => {
        const config = getConfig(period);
        return (
          <Card key={period}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base capitalize">{period} Budget</CardTitle>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(v) => updateLocal(period, { enabled: v })}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-2">
                  <Label>Limit (USD)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={config.limitUsd}
                    onChange={(e) => updateLocal(period, { limitUsd: e.target.value })}
                    disabled={!config.enabled}
                  />
                </div>
                <Button
                  onClick={() => save(period)}
                  disabled={saving === period}
                  size="sm"
                >
                  {saving === period ? "Saving..." : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
