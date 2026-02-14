import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { budgetConfig } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getBudgetUsage } from "@/lib/db/queries";

export async function GET() {
  const usage = await getBudgetUsage();
  const configs = await db.select().from(budgetConfig);
  return NextResponse.json({ configs, usage });
}

export async function PUT(request: NextRequest) {
  let body: { period: string; limitUsd: number; enabled?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON", type: "invalid_request_error", code: "invalid_json" } },
      { status: 400 }
    );
  }

  const { period, limitUsd, enabled = true } = body;

  if (!["daily", "weekly", "monthly"].includes(period)) {
    return NextResponse.json(
      { error: { message: "period must be daily, weekly, or monthly", type: "invalid_request_error", code: "invalid_period" } },
      { status: 400 }
    );
  }

  if (typeof limitUsd !== "number" || limitUsd <= 0) {
    return NextResponse.json(
      { error: { message: "limitUsd must be a positive number", type: "invalid_request_error", code: "invalid_limit" } },
      { status: 400 }
    );
  }

  // Upsert: check if a config for this period already exists
  const existing = await db.select().from(budgetConfig).where(eq(budgetConfig.period, period)).limit(1);

  if (existing.length > 0) {
    await db
      .update(budgetConfig)
      .set({ limitUsd: limitUsd.toFixed(2), enabled, updatedAt: new Date() })
      .where(eq(budgetConfig.period, period));
  } else {
    await db.insert(budgetConfig).values({
      period,
      limitUsd: limitUsd.toFixed(2),
      enabled,
    });
  }

  return NextResponse.json({ success: true, period, limitUsd, enabled });
}
