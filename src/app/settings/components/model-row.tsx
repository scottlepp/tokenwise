"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Trash2 } from "lucide-react";

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

const TIER_COLORS: Record<string, string> = {
  economy: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  standard: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  premium: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};

export function ModelRow({ model, onUpdate }: { model: Model; onUpdate: () => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    displayName: model.displayName,
    tier: model.tier,
    costPerMInputTokens: String(model.costPerMInputTokens),
    costPerMOutputTokens: String(model.costPerMOutputTokens),
    maxContextTokens: String(model.maxContextTokens),
    supportsStreaming: model.supportsStreaming,
    supportsTools: model.supportsTools,
    supportsVision: model.supportsVision,
  });

  async function toggleEnabled(enabled: boolean) {
    await fetch("/api/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: model.id, enabled }),
    });
    onUpdate();
  }

  async function handleSave() {
    setSaving(true);
    await fetch("/api/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: model.id,
        displayName: form.displayName,
        tier: form.tier,
        costPerMInputTokens: parseFloat(form.costPerMInputTokens),
        costPerMOutputTokens: parseFloat(form.costPerMOutputTokens),
        maxContextTokens: parseInt(form.maxContextTokens, 10),
        supportsStreaming: form.supportsStreaming,
        supportsTools: form.supportsTools,
        supportsVision: form.supportsVision,
      }),
    });
    setSaving(false);
    setEditOpen(false);
    onUpdate();
  }

  async function handleDelete() {
    if (!confirm(`Delete model "${model.displayName}"?`)) return;
    await fetch("/api/models", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: model.id }),
    });
    onUpdate();
  }

  return (
    <>
      <div className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50">
        <div className="flex items-center gap-3 min-w-0">
          <Switch
            checked={model.enabled}
            onCheckedChange={toggleEnabled}
            aria-label={`Toggle ${model.displayName}`}
          />
          <div className="min-w-0">
            <div className="font-medium text-sm truncate">{model.displayName}</div>
            <div className="text-xs text-muted-foreground font-mono">{model.modelId}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`text-xs ${TIER_COLORS[model.tier] ?? ""}`}>
            {model.tier}
          </Badge>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            ${Number(model.costPerMInputTokens)}/{Number(model.costPerMOutputTokens)}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Model: {model.modelId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Tier</Label>
              <Select value={form.tier} onValueChange={(v) => setForm({ ...form, tier: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="economy">Economy</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cost/M Input Tokens ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.costPerMInputTokens}
                  onChange={(e) => setForm({ ...form, costPerMInputTokens: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Cost/M Output Tokens ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.costPerMOutputTokens}
                  onChange={(e) => setForm({ ...form, costPerMOutputTokens: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Max Context Tokens</Label>
              <Input
                type="number"
                value={form.maxContextTokens}
                onChange={(e) => setForm({ ...form, maxContextTokens: e.target.value })}
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Supports Streaming</Label>
                <Switch
                  checked={form.supportsStreaming}
                  onCheckedChange={(v) => setForm({ ...form, supportsStreaming: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Supports Tools</Label>
                <Switch
                  checked={form.supportsTools}
                  onCheckedChange={(v) => setForm({ ...form, supportsTools: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label>Supports Vision</Label>
                <Switch
                  checked={form.supportsVision}
                  onCheckedChange={(v) => setForm({ ...form, supportsVision: v })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
