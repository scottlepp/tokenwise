import { NextResponse } from "next/server";
import { getActiveRequests } from "@/lib/active-requests";
import { getRecentTaskLogs } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const [active, recent] = await Promise.all([
    Promise.resolve(getActiveRequests()),
    getRecentTaskLogs(20).catch(() => []),
  ]);

  return NextResponse.json({ active, recent });
}
