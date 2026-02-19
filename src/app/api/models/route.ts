import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { modelsTable, providerConfig } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { initializeProviders } from "@/lib/providers";

export async function GET() {
  await initializeProviders();

  const models = await db
    .select({
      id: modelsTable.id,
      modelId: modelsTable.modelId,
      providerId: modelsTable.providerId,
      displayName: modelsTable.displayName,
      tier: modelsTable.tier,
      costPerMInputTokens: modelsTable.costPerMInputTokens,
      costPerMOutputTokens: modelsTable.costPerMOutputTokens,
      maxContextTokens: modelsTable.maxContextTokens,
      supportsStreaming: modelsTable.supportsStreaming,
      supportsTools: modelsTable.supportsTools,
      supportsVision: modelsTable.supportsVision,
      enabled: modelsTable.enabled,
      createdAt: modelsTable.createdAt,
      updatedAt: modelsTable.updatedAt,
    })
    .from(modelsTable);

  return NextResponse.json({ data: models });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const {
    modelId,
    providerId,
    displayName,
    tier,
    costPerMInputTokens,
    costPerMOutputTokens,
    maxContextTokens,
    supportsStreaming,
    supportsTools,
    supportsVision,
  } = body as {
    modelId?: string;
    providerId?: string;
    displayName?: string;
    tier?: string;
    costPerMInputTokens?: number;
    costPerMOutputTokens?: number;
    maxContextTokens?: number;
    supportsStreaming?: boolean;
    supportsTools?: boolean;
    supportsVision?: boolean;
  };

  if (!modelId || !providerId || !displayName || !tier) {
    return NextResponse.json(
      { error: { message: "modelId, providerId, displayName, and tier are required", type: "invalid_request_error", code: "missing_field" } },
      { status: 400 }
    );
  }

  // Verify provider exists
  const provider = await db
    .select()
    .from(providerConfig)
    .where(eq(providerConfig.providerId, providerId))
    .limit(1);

  if (provider.length === 0) {
    return NextResponse.json(
      { error: { message: `Provider '${providerId}' not found`, type: "invalid_request_error", code: "not_found" } },
      { status: 404 }
    );
  }

  const [inserted] = await db
    .insert(modelsTable)
    .values({
      modelId,
      providerId,
      displayName,
      tier,
      costPerMInputTokens: String(costPerMInputTokens ?? 0),
      costPerMOutputTokens: String(costPerMOutputTokens ?? 0),
      maxContextTokens: maxContextTokens ?? 128000,
      supportsStreaming: supportsStreaming ?? true,
      supportsTools: supportsTools ?? false,
      supportsVision: supportsVision ?? false,
    })
    .returning();

  return NextResponse.json({ data: inserted }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const { id, modelId, providerId, ...updates } = body as {
    id?: string;
    modelId?: string;
    providerId?: string;
    enabled?: boolean;
    displayName?: string;
    tier?: string;
    costPerMInputTokens?: number;
    costPerMOutputTokens?: number;
    maxContextTokens?: number;
    supportsStreaming?: boolean;
    supportsTools?: boolean;
    supportsVision?: boolean;
  };

  // Find the model by UUID id, or by (providerId, modelId)
  let condition;
  if (id) {
    condition = eq(modelsTable.id, id);
  } else if (providerId && modelId) {
    condition = and(eq(modelsTable.providerId, providerId), eq(modelsTable.modelId, modelId));
  } else {
    return NextResponse.json(
      { error: { message: "id or (providerId + modelId) required", type: "invalid_request_error", code: "missing_field" } },
      { status: 400 }
    );
  }

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
  if (updates.displayName !== undefined) setValues.displayName = updates.displayName;
  if (updates.tier !== undefined) setValues.tier = updates.tier;
  if (updates.costPerMInputTokens !== undefined) setValues.costPerMInputTokens = String(updates.costPerMInputTokens);
  if (updates.costPerMOutputTokens !== undefined) setValues.costPerMOutputTokens = String(updates.costPerMOutputTokens);
  if (updates.maxContextTokens !== undefined) setValues.maxContextTokens = updates.maxContextTokens;
  if (updates.supportsStreaming !== undefined) setValues.supportsStreaming = updates.supportsStreaming;
  if (updates.supportsTools !== undefined) setValues.supportsTools = updates.supportsTools;
  if (updates.supportsVision !== undefined) setValues.supportsVision = updates.supportsVision;

  const [updated] = await db
    .update(modelsTable)
    .set(setValues)
    .where(condition)
    .returning();

  if (!updated) {
    return NextResponse.json(
      { error: { message: "Model not found", type: "invalid_request_error", code: "not_found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: updated });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const { id, modelId, providerId } = body as {
    id?: string;
    modelId?: string;
    providerId?: string;
  };

  let condition;
  if (id) {
    condition = eq(modelsTable.id, id);
  } else if (providerId && modelId) {
    condition = and(eq(modelsTable.providerId, providerId), eq(modelsTable.modelId, modelId));
  } else {
    return NextResponse.json(
      { error: { message: "id or (providerId + modelId) required", type: "invalid_request_error", code: "missing_field" } },
      { status: 400 }
    );
  }

  const [deleted] = await db
    .delete(modelsTable)
    .where(condition)
    .returning();

  if (!deleted) {
    return NextResponse.json(
      { error: { message: "Model not found", type: "invalid_request_error", code: "not_found" } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
