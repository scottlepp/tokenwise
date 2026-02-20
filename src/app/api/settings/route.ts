import { NextRequest, NextResponse } from "next/server";
import { isLlmClassifierEnabled, setLlmClassifierEnabled } from "@/lib/task-classifier";
import { getPinnedModel, setPinnedModel } from "@/lib/pinned-model-setting";

export async function GET() {
  return NextResponse.json({
    data: {
      llmClassifierEnabled: isLlmClassifierEnabled(),
      pinnedModel: getPinnedModel(),
    },
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;

  if (typeof body.llmClassifierEnabled === "boolean") {
    setLlmClassifierEnabled(body.llmClassifierEnabled);
  }

  if ("pinnedModel" in body) {
    const val = body.pinnedModel;
    setPinnedModel(typeof val === "string" && val.trim() ? val.trim() : null);
  }

  return NextResponse.json({
    data: {
      llmClassifierEnabled: isLlmClassifierEnabled(),
      pinnedModel: getPinnedModel(),
    },
  });
}
