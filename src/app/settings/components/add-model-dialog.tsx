"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

interface AddModelDialogProps {
  providerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddModelDialog({ providerId, open, onOpenChange, onSuccess }: AddModelDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    modelId: "",
    displayName: "",
    tier: "standard",
    costPerMInputTokens: "0",
    costPerMOutputTokens: "0",
    maxContextTokens: "128000",
    supportsStreaming: true,
    supportsTools: false,
    supportsVision: false,
  });

  function resetForm() {
    setForm({
      modelId: "",
      displayName: "",
      tier: "standard",
      costPerMInputTokens: "0",
      costPerMOutputTokens: "0",
      maxContextTokens: "128000",
      supportsStreaming: true,
      supportsTools: false,
      supportsVision: false,
    });
    setError(null);
  }

  async function handleSubmit() {
    if (!form.modelId || !form.displayName) {
      setError("Model ID and Display Name are required.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: form.modelId,
        providerId,
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

    if (!res.ok) {
      const data = await res.json();
      setError(data.error?.message ?? "Failed to add model.");
      return;
    }

    resetForm();
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Model to {providerId}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Model ID</Label>
              <Input
                placeholder="e.g. gpt-4o-2024-08-06"
                value={form.modelId}
                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input
                placeholder="e.g. GPT-4o (Aug 2024)"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
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
          <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Adding..." : "Add Model"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
