import { NextRequest } from "next/server";
import { getActiveRequests } from "@/lib/active-requests";
import { getRecentTaskLogs } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let active = true;

      const send = (data: unknown) => {
        if (!active) return;
        try {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
        } catch {
          active = false;
        }
      };

      // Send initial snapshot
      const recent = await getRecentTaskLogs(20).catch(() => []);
      send({ type: "snapshot", active: getActiveRequests(), recent });

      // Poll every 500ms
      const interval = setInterval(async () => {
        if (!active) {
          clearInterval(interval);
          return;
        }
        try {
          const recentUpdated = await getRecentTaskLogs(20).catch(() => []);
          send({ type: "snapshot", active: getActiveRequests(), recent: recentUpdated });
        } catch {
          // ignore
        }
      }, 500);

      // Cleanup on close
      return () => {
        active = false;
        clearInterval(interval);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
