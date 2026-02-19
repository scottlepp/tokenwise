"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PROVIDER_COLORS } from "@/lib/constants";
import { Plus, Trash2, Key, CheckCircle2, XCircle } from "lucide-react";
import { ModelRow } from "./model-row";
import { AddModelDialog } from "./add-model-dialog";

interface Model {
  id: string;
  modelId: string;
  providerId: string;
  displayName: string;
  tier: string;
  costPerMInputTokens: string | number;
  costPerMOutputTokens: string | number;
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  enabled: boolean;
}

interface ProviderData {
  id: string;
  displayName: string;
  enabled: boolean;
  priority: number;
  isBuiltin: boolean;
  isActive: boolean;
  hasApiKey: boolean;
  models: Model[];
}

export function ProviderCard({ provider, onUpdate }: { provider: ProviderData; onUpdate: () => void }) {
  const [priority, setPriority] = useState(String(provider.priority));
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggleEnabled(enabled: boolean) {
    await fetch("/api/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: provider.id, enabled }),
    });
    onUpdate();
  }

  async function updatePriority() {
    const val = parseInt(priority, 10);
    if (isNaN(val)) return;
    await fetch("/api/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: provider.id, priority: val }),
    });
    onUpdate();
  }

  async function saveApiKey() {
    if (!apiKeyInput.trim()) return;
    setSavingKey(true);
    await fetch("/api/providers", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: provider.id, apiKey: apiKeyInput.trim() }),
    });
    setApiKeyInput("");
    setSavingKey(false);
    onUpdate();
  }

  async function deleteProvider() {
    if (!confirm(`Delete provider "${provider.displayName}" and all its models?`)) return;
    setDeleting(true);
    await fetch("/api/providers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: provider.id }),
    });
    setDeleting(false);
    onUpdate();
  }

  const enabledModels = provider.models.filter((m) => m.enabled).length;

  // Determine which providers need an API key input
  const needsApiKey = provider.id !== "claude-cli" && provider.id !== "ollama";

  return (
    <Card className="flex flex-col" style={{ borderLeftColor: PROVIDER_COLORS[provider.id] ?? "#888", borderLeftWidth: 4 }}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <CardTitle className="text-lg">{provider.displayName}</CardTitle>
            <Badge variant="outline" className="text-xs font-mono shrink-0">{provider.id}</Badge>
            {provider.hasApiKey ? (
              <Badge variant="secondary" className="text-xs gap-1 shrink-0">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                Key set
              </Badge>
            ) : needsApiKey ? (
              <Badge variant="destructive" className="text-xs gap-1 shrink-0">
                <XCircle className="h-3 w-3" />
                No key
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!provider.isBuiltin && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={deleteProvider}
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Switch
              checked={provider.enabled}
              onCheckedChange={toggleEnabled}
              aria-label={`Toggle ${provider.displayName}`}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">Priority</Label>
            <Input
              type="number"
              className="w-20 h-8"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              onBlur={updatePriority}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            {enabledModels}/{provider.models.length} models enabled
          </div>
        </div>

        {needsApiKey && (
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-sm text-muted-foreground flex items-center gap-1">
                <Key className="h-3 w-3" />
                API Key
              </Label>
              <Input
                type="password"
                placeholder={provider.hasApiKey ? "••••••••  (key is set, enter new to replace)" : "Enter API key..."}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
              />
            </div>
            <Button
              size="sm"
              onClick={saveApiKey}
              disabled={!apiKeyInput.trim() || savingKey}
            >
              {savingKey ? "Saving..." : "Save"}
            </Button>
          </div>
        )}

        <Accordion type="single" collapsible>
          <AccordionItem value="models" className="border-0">
            <AccordionTrigger className="py-2 text-sm">
              Models ({provider.models.length})
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-1">
                {provider.models.map((model) => (
                  <ModelRow key={model.id} model={model} onUpdate={onUpdate} />
                ))}
                {provider.models.length === 0 && (
                  <div className="text-sm text-muted-foreground py-2">No models configured.</div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => setAddModelOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Model
              </Button>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <AddModelDialog
          providerId={provider.id}
          open={addModelOpen}
          onOpenChange={setAddModelOpen}
          onSuccess={onUpdate}
        />
      </CardContent>
    </Card>
  );
}
