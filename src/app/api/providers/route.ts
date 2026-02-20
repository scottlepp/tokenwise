import { NextRequest, NextResponse } from "next/server";
import { providerRegistry, initializeProviders, reinitializeProviders, isBuiltinProvider } from "@/lib/providers";
import { db } from "@/lib/db";
import { providerConfig, modelsTable } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  await initializeProviders();

  // Return ALL providers from DB (not just registered ones)
  const dbProviders = await db.select().from(providerConfig).orderBy(desc(providerConfig.priority));
  const allModels = await db.select().from(modelsTable);

  const providers = dbProviders.map((p) => {
    const registeredProvider = providerRegistry.get(p.providerId);
    const providerModels = allModels.filter((m) => m.providerId === p.providerId);
    const configJson = p.configJson as Record<string, unknown> | undefined;

    return {
      id: p.providerId,
      displayName: p.displayName,
      enabled: p.enabled,
      priority: p.priority,
      isBuiltin: isBuiltinProvider(p.providerId),
      isActive: !!registeredProvider,
      hasApiKey: !!(configJson?.apiKey) || isBuiltinProviderWithEnvKey(p.providerId),
      modelCount: providerModels.length,
      models: providerModels.map((m) => ({
        id: m.id,
        modelId: m.modelId,
        providerId: m.providerId,
        displayName: m.displayName,
        tier: m.tier,
        costPerMInputTokens: m.costPerMInputTokens,
        costPerMOutputTokens: m.costPerMOutputTokens,
        maxContextTokens: m.maxContextTokens,
        supportsStreaming: m.supportsStreaming,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        enabled: m.enabled,
      })),
    };
  });

  return NextResponse.json({ data: providers });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const { providerId, displayName, apiKey, baseUrl, priority } = body as {
    providerId?: string;
    displayName?: string;
    apiKey?: string;
    baseUrl?: string;
    priority?: number;
  };

  if (!providerId || !displayName) {
    return NextResponse.json(
      { error: { message: "providerId and displayName are required", type: "invalid_request_error", code: "missing_field" } },
      { status: 400 }
    );
  }

  // For non-builtin providers, baseUrl is required
  if (!isBuiltinProvider(providerId) && !baseUrl) {
    return NextResponse.json(
      { error: { message: "baseUrl is required for custom providers", type: "invalid_request_error", code: "missing_field" } },
      { status: 400 }
    );
  }

  // Check if provider already exists
  const existing = await db
    .select()
    .from(providerConfig)
    .where(eq(providerConfig.providerId, providerId))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: { message: `Provider '${providerId}' already exists`, type: "invalid_request_error", code: "conflict" } },
      { status: 409 }
    );
  }

  // Build configJson
  const configJson: Record<string, unknown> = {};
  if (apiKey) configJson.apiKey = apiKey;
  if (baseUrl) configJson.baseUrl = baseUrl;

  const [inserted] = await db
    .insert(providerConfig)
    .values({
      providerId,
      displayName,
      enabled: true,
      priority: priority ?? 0,
      configJson,
    })
    .returning();

  // Reinitialize providers so the new one becomes active
  await reinitializeProviders();

  return NextResponse.json({ data: inserted }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const { providerId, enabled, priority, apiKey, baseUrl } = body as {
    providerId?: string;
    enabled?: boolean;
    priority?: number;
    apiKey?: string;
    baseUrl?: string;
  };

  if (!providerId) {
    return NextResponse.json(
      { error: { message: "providerId is required", type: "invalid_request_error", code: "missing_field" } },
      { status: 400 }
    );
  }

  // Get existing config
  const existing = await db
    .select()
    .from(providerConfig)
    .where(eq(providerConfig.providerId, providerId))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json(
      { error: { message: `Provider '${providerId}' not found`, type: "invalid_request_error", code: "not_found" } },
      { status: 404 }
    );
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (enabled !== undefined) updates.enabled = enabled;
  if (priority !== undefined) updates.priority = priority;

  // Update configJson if apiKey or baseUrl provided
  if (apiKey !== undefined || baseUrl !== undefined) {
    const currentConfig = (existing[0].configJson as Record<string, unknown>) ?? {};
    const newConfig = { ...currentConfig };
    if (apiKey !== undefined) newConfig.apiKey = apiKey;
    if (baseUrl !== undefined) newConfig.baseUrl = baseUrl;
    updates.configJson = newConfig;
  }

  await db.update(providerConfig).set(updates).where(eq(providerConfig.providerId, providerId));

  // Reinitialize providers to pick up config changes
  await reinitializeProviders();

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const { providerId } = body as { providerId?: string };

  if (!providerId) {
    return NextResponse.json(
      { error: { message: "providerId is required", type: "invalid_request_error", code: "missing_field" } },
      { status: 400 }
    );
  }

  // Don't allow deleting built-in providers — they can be disabled instead
  if (isBuiltinProvider(providerId)) {
    return NextResponse.json(
      { error: { message: "Built-in providers cannot be deleted. Disable them instead.", type: "invalid_request_error", code: "forbidden" } },
      { status: 400 }
    );
  }

  // Delete models first (FK constraint)
  await db.delete(modelsTable).where(eq(modelsTable.providerId, providerId));

  // Delete provider config
  const [deleted] = await db
    .delete(providerConfig)
    .where(eq(providerConfig.providerId, providerId))
    .returning();

  if (!deleted) {
    return NextResponse.json(
      { error: { message: "Provider not found", type: "invalid_request_error", code: "not_found" } },
      { status: 404 }
    );
  }

  // Reinitialize providers
  await reinitializeProviders();

  return NextResponse.json({ success: true });
}

/** Check if a built-in provider has its API key set via env var */
function isBuiltinProviderWithEnvKey(providerId: string): boolean {
  switch (providerId) {
    case "claude-cli": return true; // Uses OAuth, no key needed
    case "claude-api": return !!process.env.ANTHROPIC_API_KEY;
    case "openai": return !!process.env.OPENAI_API_KEY;
    case "gemini": return !!process.env.GEMINI_API_KEY;
    case "ollama": return true; // No key needed
    default: return false;
  }
}
