"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PROVIDER_COLORS, providerLabel, shortModelLabel } from "@/lib/constants";
import type { ActiveRequest } from "@/lib/active-requests";

// Type for recent task logs
interface RecentTaskLog {
  id: string;
  createdAt: string; // ISO string from JSON
  provider: string;
  modelSelected: string;
  taskCategory: string;
  complexityScore: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  latencyMs: number;
  streaming: boolean;
  cliSuccess: boolean;
  heuristicScore: number | null;
  userRating: number | null;
  promptSummary: string | null;
  promptText: string | null;
  responseText: string | null;
}

// ElapsedTimer component
function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span>{elapsed}s</span>;
}

// Active request card
function ActiveRequestCard({ req }: { req: ActiveRequest }) {
  const color = PROVIDER_COLORS[req.provider] ?? "#8b5cf6";

  return (
    <Card className="border-l-4 animate-pulse-subtle" style={{ borderLeftColor: color }}>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }} />
            <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
          </span>
          <Badge variant="outline" style={{ borderColor: color, color }}>
            {providerLabel(req.provider)}
          </Badge>
          <Badge variant="secondary">{shortModelLabel(req.model)}</Badge>
          <Badge variant="outline" className="text-muted-foreground">{req.category}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            <ElapsedTimer startedAt={req.startedAt} /> elapsed
          </span>
        </div>

        {req.promptPreview && (
          <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
            <span className="font-medium">Prompt:</span> {req.promptPreview}
          </p>
        )}

        {req.partialText && (
          <div className="bg-muted rounded p-2 text-xs font-mono max-h-32 overflow-y-auto">
            <span>{req.partialText}</span>
            <span className="animate-pulse">▌</span>
          </div>
        )}

        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
          <span>~{req.tokensOut} tokens out</span>
        </div>
      </CardContent>
    </Card>
  );
}

// Completed request card
function CompletedRequestCard({ log }: { log: RecentTaskLog }) {
  const [expanded, setExpanded] = useState(false);
  const color = PROVIDER_COLORS[log.provider] ?? "#8b5cf6";
  const cost = parseFloat(log.costUsd);

  return (
    <Card className="border-l-4" style={{ borderLeftColor: color }}>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-2">
          <Badge variant="outline" style={{ borderColor: color, color }}>
            {providerLabel(log.provider)}
          </Badge>
          <Badge variant="secondary">{shortModelLabel(log.modelSelected)}</Badge>
          <Badge variant="outline" className="text-muted-foreground">{log.taskCategory}</Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {new Date(log.createdAt).toLocaleTimeString()}
          </span>
        </div>

        {log.promptText || log.promptSummary ? (
          <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
            <span className="font-medium">Prompt:</span> {log.promptText ?? log.promptSummary}
          </p>
        ) : null}

        {log.responseText && (
          <div>
            <div className={`bg-muted rounded p-2 text-xs font-mono ${expanded ? "" : "max-h-16 overflow-hidden"}`}>
              {log.responseText}
            </div>
            {log.responseText.length > 200 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs mt-1 h-6 px-2"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "Show less" : "Show full response"}
              </Button>
            )}
          </div>
        )}

        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
          <span>{log.tokensIn + log.tokensOut} tokens</span>
          {cost > 0 && <span>${cost.toFixed(4)}</span>}
          <span>{log.latencyMs}ms</span>
          {log.heuristicScore !== null && (
            <span className={log.heuristicScore >= 70 ? "text-green-500" : "text-red-500"}>
              {log.heuristicScore}/100
            </span>
          )}
          {!log.cliSuccess && <span className="text-red-500">Failed</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ActivityPage() {
  const [active, setActive] = useState<ActiveRequest[]>([]);
  const [recent, setRecent] = useState<RecentTaskLog[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    function connect() {
      const es = new EventSource("/api/activity/stream");

      es.onopen = () => setConnected(true);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "snapshot") {
            setActive(data.active ?? []);
            setRecent(data.recent ?? []);
          }
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Reconnect after 3s
        setTimeout(connect, 3000);
      };

      return () => es.close();
    }

    return connect();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Live Activity</h1>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-xs text-muted-foreground">{connected ? "Connected" : "Reconnecting..."}</span>
        </div>
      </div>

      {/* Active Requests */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-lg font-semibold">Active</h2>
          {active.length > 0 && (
            <Badge variant="destructive" className="text-xs">{active.length}</Badge>
          )}
        </div>
        {active.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              No active requests — waiting for AI agent activity...
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {active.map((req) => (
              <ActiveRequestCard key={req.taskId} req={req} />
            ))}
          </div>
        )}
      </section>

      {/* Recent Completions */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Recent Completions</h2>
        {recent.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              No recent requests logged yet
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {recent.map((log) => (
              <CompletedRequestCard key={log.id} log={log} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}