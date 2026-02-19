import { NextRequest, NextResponse } from "next/server";
import { isLlmClassifierEnabled, setLlmClassifierEnabled } from "@/lib/task-classifier";

export async function GET() {
  return NextResponse.json({
    data: {
      llmClassifierEnabled: isLlmClassifierEnabled(),
    },
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;

  if (typeof body.llmClassifierEnabled === "boolean") {
    setLlmClassifierEnabled(body.llmClassifierEnabled);
  }

  return NextResponse.json({
    data: {
      llmClassifierEnabled: isLlmClassifierEnabled(),
    },
  });
}
