import { NextRequest, NextResponse } from "next/server";
import { warmPool } from "@/lib/warm-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/warm-pool — return current pool status */
export async function GET() {
  return NextResponse.json({ data: warmPool.getStatus() });
}

/** POST /api/warm-pool — start, stop, or restart the pool */
export async function POST(request: NextRequest) {
  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error", code: "invalid_json" } },
      { status: 400 },
    );
  }

  const { action } = body;

  switch (action) {
    case "start":
      await warmPool.start();
      break;
    case "stop":
      await warmPool.stop();
      break;
    case "restart":
      await warmPool.restart();
      break;
    default:
      return NextResponse.json(
        { error: { message: `Invalid action: ${action}. Use 'start', 'stop', or 'restart'.`, type: "invalid_request_error", code: "invalid_action" } },
        { status: 400 },
      );
  }

  return NextResponse.json({ data: warmPool.getStatus() });
}
