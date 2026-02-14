import { NextResponse } from "next/server";
import { AVAILABLE_MODELS } from "@/lib/config";

export async function GET() {
  return NextResponse.json({
    object: "list",
    data: AVAILABLE_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: 1700000000,
      owned_by: "claude-proxy",
    })),
  });
}
