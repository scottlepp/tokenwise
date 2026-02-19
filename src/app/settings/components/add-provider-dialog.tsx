"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddProviderDialog({ open, onOpenChange, onSuccess }: AddProviderDialogProps) {
  const [providerId, setProviderId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setProviderId("");
    setDisplayName("");
    setBaseUrl("");
    setApiKey("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!providerId.trim() || !displayName.trim() || !baseUrl.trim()) {
      setError("Provider ID, display name, and base URL are required.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: providerId.trim(),
        displayName: displayName.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
      }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error?.message ?? "Failed to add provider");
      return;
    }

    reset();
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Provider</DialogTitle>
          <DialogDescription>
            Add an OpenAI-compatible provider. The provider must support the OpenAI chat completions API format.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Provider ID</Label>
            <Input
              placeholder="e.g., groq, together, fireworks"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier (lowercase, alphanumeric with dashes)
            </p>
          </div>

          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input
              placeholder="e.g., Groq, Together AI, Fireworks"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Base URL</Label>
            <Input
              placeholder="e.g., https://api.groq.com/openai/v1"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The OpenAI-compatible API base URL (without /chat/completions)
            </p>
          </div>

          <div className="space-y-2">
            <Label>API Key (optional)</Label>
            <Input
              type="password"
              placeholder="Enter API key..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              You can also add the key later from the provider card.
            </p>
          </div>

          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { onOpenChange(false); reset(); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add Provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
