"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface WarmProcessInfo {
  modelId: string;
  displayName: string;
  status: "idle" | "busy" | "dead" | "starting";
  pid: number | null;
  requestsServed: number;
  lastUsedAt: number | null;
  contextDepth: number;
}

interface WarmPoolStatusData {
  running: boolean;
  startedAt: number | null;
  idleTimeoutMs: number;
  models: WarmProcessInfo[];
}

const statusColors: Record<string, string> = {
  idle: "bg-green-500/20 text-green-700 border-green-500/30",
  busy: "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
  dead: "bg-red-500/20 text-red-700 border-red-500/30",
  starting: "bg-blue-500/20 text-blue-700 border-blue-500/30",
};

export function WarmPoolStatus() {
  const [data, setData] = useState<WarmPoolStatusData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/warm-pool");
      const json = await res.json();
      setData(json.data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleAction = async (action: "start" | "stop" | "restart") => {
    setLoading(true);
    try {
      const res = await fetch("/api/warm-pool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      setData(json.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (ts: number | null) => {
    if (!ts) return "—";
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Warm Pool</CardTitle>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={data?.running
              ? "bg-green-500/20 text-green-700 border-green-500/30"
              : "bg-gray-500/20 text-gray-600 border-gray-500/30"
            }
          >
            {data?.running ? "Running" : "Stopped"}
          </Badge>
          {data?.running ? (
            <>
              <Button size="sm" variant="outline" disabled={loading} onClick={() => handleAction("restart")}>
                Restart
              </Button>
              <Button size="sm" variant="destructive" disabled={loading} onClick={() => handleAction("stop")}>
                Stop
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={loading} onClick={() => handleAction("start")}>
              Start
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {data?.running && data.models.length > 0 ? (
          <div className="space-y-2">
            {data.models.map((m) => (
              <div key={m.modelId} className="flex items-center justify-between text-sm border rounded-md p-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={statusColors[m.status] ?? ""}>
                    {m.status}
                  </Badge>
                  <span className="font-medium">{m.displayName || m.modelId}</span>
                </div>
                <div className="flex items-center gap-4 text-muted-foreground text-xs">
                  {m.pid && <span>PID {m.pid}</span>}
                  <span>{m.requestsServed} reqs</span>
                  <span>{m.contextDepth} ctx</span>
                  <span>{formatTime(m.lastUsedAt)}</span>
                </div>
              </div>
            ))}
            {data.startedAt && (
              <div className="text-xs text-muted-foreground pt-1">
                Uptime: {formatTime(data.startedAt).replace(" ago", "")} | Idle timeout: {Math.floor(data.idleTimeoutMs / 60000)}m
              </div>
            )}
          </div>
        ) : !data?.running ? (
          <p className="text-sm text-muted-foreground">
            Start the warm pool to pre-spawn Claude CLI processes for faster responses.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No models configured.</p>
        )}
      </CardContent>
    </Card>
  );
}
