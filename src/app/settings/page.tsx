"use client";

import { useEffect, useState, useCallback } from "react";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { ProviderCard } from "./components/provider-card";
import { AddProviderDialog } from "./components/add-provider-dialog";
import { BudgetSettings } from "./components/budget-settings";
import { WarmPoolStatus } from "../dashboard/components/warm-pool-status";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function SettingsPage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [llmClassifier, setLlmClassifier] = useState(false);
  const [pinnedModel, setPinnedModel] = useState<string | null>(null);
  const [addProviderOpen, setAddProviderOpen] = useState(false);

  /** Claude CLI models available for pinning */
  const cliModels: { id: string; displayName: string }[] = (providers
    .find((p: any) => p.id === "claude-cli")
    ?.models ?? []).map((m: any) => ({ id: m.id, displayName: m.displayName }));

  const fetchData = useCallback(async () => {
    const [providersRes, settingsRes] = await Promise.all([
      fetch("/api/providers").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]);
    setProviders(providersRes.data ?? []);
    setLlmClassifier(settingsRes.data?.llmClassifierEnabled ?? false);
    setPinnedModel(settingsRes.data?.pinnedModel ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function toggleLlmClassifier(enabled: boolean) {
    setLlmClassifier(enabled);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llmClassifierEnabled: enabled }),
    });
  }

  async function changePinnedModel(value: string) {
    const model = value === "none" ? null : value;
    setPinnedModel(model);
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinnedModel: model }),
    });
  }

  return (
    <SidebarInset>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 !h-4" />
        <h1 className="text-lg font-semibold">Settings</h1>
      </header>
      <main className="flex-1 p-6">
        <Tabs defaultValue="providers" className="space-y-6">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="providers">Providers</TabsTrigger>
              <TabsTrigger value="budget">Budget</TabsTrigger>
              <TabsTrigger value="general">General</TabsTrigger>
            </TabsList>
            <Button
              size="sm"
              onClick={() => setAddProviderOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Provider
            </Button>
          </div>

          <TabsContent value="providers">
            {loading ? (
              <div className="text-center py-20 text-muted-foreground">Loading providers...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {providers.map((p: any) => (
                  <ProviderCard key={p.id} provider={p} onUpdate={fetchData} />
                ))}
                {providers.length === 0 && (
                  <div className="col-span-full text-center py-8 text-muted-foreground">
                    No providers configured yet.
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="budget">
            <div className="max-w-lg">
              <BudgetSettings />
            </div>
          </TabsContent>

          <TabsContent value="general">
            <div className="max-w-lg space-y-4">
              <WarmPoolStatus />

              <Card>
                <CardHeader>
                  <CardTitle>Pinned Model</CardTitle>
                  <CardDescription>
                    Pin a single Claude CLI model to a long-lived process. All requests use this
                    process, eliminating startup cost. Simpler than the warm pool (no context
                    tracking, single model). Set to &quot;None&quot; to disable.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <Label>Claude CLI Model</Label>
                    <Select
                      value={pinnedModel ?? "none"}
                      onValueChange={changePinnedModel}
                    >
                      <SelectTrigger className="w-[260px]">
                        <SelectValue placeholder="None (disabled)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None (disabled)</SelectItem>
                        {cliModels.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>LLM Classifier</CardTitle>
                  <CardDescription>
                    Use an LLM (Haiku) to classify task complexity instead of keyword heuristics.
                    More accurate routing but costs ~$0.001 per request.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <Label>Enable LLM Classifier</Label>
                    <Switch
                      checked={llmClassifier}
                      onCheckedChange={toggleLlmClassifier}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <AddProviderDialog
        open={addProviderOpen}
        onOpenChange={setAddProviderOpen}
        onSuccess={fetchData}
      />
    </SidebarInset>
  );
}
