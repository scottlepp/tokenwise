import { NextResponse } from "next/server";
import { STATIC_MODELS } from "@/lib/config";
import { providerRegistry, initializeProviders } from "@/lib/providers";

export async function GET() {
  await initializeProviders();

  // Combine static models (auto, tier names, aliases) with dynamic provider models
  const providerModels = providerRegistry.getAllModels().map((m) => ({
    id: m.id,
    object: "model" as const,
    created: 1700000000,
    owned_by: m.provider,
  }));

  // Also expose provider:model format for explicit routing
  const prefixedModels = providerRegistry.getAllModels().map((m) => ({
    id: `${m.provider}:${m.id}`,
    object: "model" as const,
    created: 1700000000,
    owned_by: m.provider,
  }));

  const staticModels = STATIC_MODELS.map((m) => ({
    id: m.id,
    object: "model" as const,
    created: 1700000000,
    owned_by: "codewise",
  }));

  // Deduplicate by id
  const seen = new Set<string>();
  const data = [];
  for (const m of [...staticModels, ...providerModels, ...prefixedModels]) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      data.push(m);
    }
  }

  return NextResponse.json({ object: "list", data });
}
