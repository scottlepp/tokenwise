"use client";

import { Fragment, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TaskLog {
  id: string;
  createdAt: string;
  taskCategory: string;
  complexityScore: number;
  provider: string;
  modelSelected: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  latencyMs: number;
  cliSuccess: boolean;
  heuristicScore: number | null;
  userRating: number | null;
  cacheHit: boolean | null;
  promptSummary: string | null;
  routerReason: string | null;
  dispatchMode: string | null;
}

interface StepLog {
  step: string;
  status: string;
  durationMs: number | null;
  detail: string | null;
}

interface DetailedRequest {
  id: string;
  createdAt: string;
  status: string;
  modelRequested: string | null;
  totalLatencyMs: number | null;
  promptPreview: string | null;
  steps: StepLog[];
  task: TaskLog | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function modelLabel(model: string): string {
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model;
}

const STEP_STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-50 text-green-700 border-green-200",
  error: "bg-red-50 text-red-700 border-red-200",
  skipped: "bg-gray-50 text-gray-500 border-gray-200",
  started: "bg-blue-50 text-blue-700 border-blue-200",
};

async function submitRating(taskId: string, rating: number) {
  await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, rating }),
  });
}

function StepTimeline({ steps }: { steps: StepLog[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 py-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1">
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${STEP_STATUS_COLORS[step.status] ?? ""}`}
          >
            {step.step.replace(/_/g, " ")}
            {step.durationMs != null && step.durationMs > 0 && (
              <span className="ml-1 opacity-70">{step.durationMs}ms</span>
            )}
          </Badge>
          {i < steps.length - 1 && <span className="text-muted-foreground text-[10px]">&rarr;</span>}
        </div>
      ))}
    </div>
  );
}

export function RecentRequests({
  data,
  detailed,
}: {
  data: TaskLog[];
  detailed?: DetailedRequest[];
}) {
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleRate = async (taskId: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [taskId]: rating }));
    await submitRating(taskId, rating);
  };

  // Build a map of request_id -> detailed info
  const detailMap = new Map<string, DetailedRequest>();
  if (detailed) {
    for (const d of detailed) {
      detailMap.set(d.id, d);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Requests</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              {detailed && <TableHead className="w-8"></TableHead>}
              <TableHead>Time</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Dispatch</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rating</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => {
              const requestId = (row as any).requestId;
              const detail = requestId ? detailMap.get(requestId) : null;
              const isExpanded = expandedId === row.id;

              return (
                <Fragment key={row.id}>
                  <TableRow
                    className={detail ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => detail && setExpandedId(isExpanded ? null : row.id)}
                  >
                    {detailed && (
                      <TableCell className="text-muted-foreground text-xs px-2">
                        {detail ? (isExpanded ? "▼" : "▶") : ""}
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">
                      {new Date(row.createdAt).toLocaleTimeString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.taskCategory}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.provider ?? "claude-cli"}
                    </TableCell>
                    <TableCell>
                      {row.dispatchMode === "warm" ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-[10px]">Warm</Badge>
                      ) : row.dispatchMode === "pinned" ? (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px]">Pinned</Badge>
                      ) : row.dispatchMode === "ephemeral" ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">Ephemeral</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge>{modelLabel(row.modelSelected)}</Badge>
                      {row.cacheHit && <Badge variant="secondary" className="ml-1">cache</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.tokensIn + row.tokensOut}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      ${parseFloat(row.costUsd).toFixed(4)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.latencyMs}ms
                    </TableCell>
                    <TableCell>
                      {row.cliSuccess ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">OK</Badge>
                      ) : (
                        <Badge variant="destructive">Error</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((star) => {
                          const current = ratings[row.id] ?? row.userRating;
                          return (
                            <Button
                              key={star}
                              variant="ghost"
                              size="sm"
                              className={`h-6 w-6 p-0 ${current && current >= star ? "text-yellow-500" : "text-gray-300"}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRate(row.id, star);
                              }}
                            >
                              ★
                            </Button>
                          );
                        })}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && detail && (
                    <TableRow key={`${row.id}-detail`}>
                      <TableCell colSpan={detailed ? 12 : 11} className="bg-muted/30 p-3">
                        <div className="space-y-2">
                          <div className="flex gap-4 text-xs text-muted-foreground">
                            <span>Request: <code className="text-[10px]">{detail.id.slice(0, 8)}</code></span>
                            <span>Status: <Badge variant="outline" className="text-[10px] px-1">{detail.status}</Badge></span>
                            {detail.totalLatencyMs && <span>Total: {detail.totalLatencyMs}ms</span>}
                            {row.routerReason && <span>Router: {row.routerReason}</span>}
                          </div>
                          {detail.steps.length > 0 && (
                            <div>
                              <div className="text-xs font-medium mb-1 text-muted-foreground">Pipeline Steps</div>
                              <StepTimeline steps={detail.steps} />
                            </div>
                          )}
                          {detail.promptPreview && (
                            <div className="text-xs text-muted-foreground truncate max-w-2xl">
                              Prompt: {detail.promptPreview}
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
