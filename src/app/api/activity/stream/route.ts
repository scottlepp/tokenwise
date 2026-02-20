import { NextRequest } from "next/server";
import { getActiveRequests } from "@/lib/active-requests";
import { getActivityFeed } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const encoder = new TextEncoder();

  let active = true;
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (!active) return;
        try {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(data) + "\n\n"));
        } catch {
          active = false;
        }
      };

      // Send initial snapshot
      const feed = await getActivityFeed(30).catch(() => []);
      send({ type: "snapshot", active: getActiveRequests(), feed });

      // Poll every 1s
      interval = setInterval(async () => {
        if (!active) {
          if (interval) clearInterval(interval);
          return;
        }
        try {
          const updatedFeed = await getActivityFeed(30).catch(() => []);
          send({ type: "snapshot", active: getActiveRequests(), feed: updatedFeed });
        } catch {
          // ignore
        }
      }, 1000);
    },
    cancel() {
      active = false;
      if (interval) clearInterval(interval);
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
