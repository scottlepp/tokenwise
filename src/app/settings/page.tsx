"use client";

import { useEffect, useState, useCallback } from "react";
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { ProviderCard } from "./components/provider-card";
import { AddProviderDialog } from "./components/add-provider-dialog";
import { BudgetSettings } from "./components/budget-settings";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function SettingsPage() {
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [llmClassifier, setLlmClassifier] = useState(false);
  const [addProviderOpen, setAddProviderOpen] = useState(false);

  const fetchData = useCallback(async () => {
    const [providersRes, settingsRes] = await Promise.all([
      fetch("/api/providers").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ]);
    setProviders(providersRes.data ?? []);
    setLlmClassifier(settingsRes.data?.llmClassifierEnabled ?? false);
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
