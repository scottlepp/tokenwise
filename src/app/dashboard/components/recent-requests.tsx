"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface TaskLog {
  id: string;
  createdAt: string;
  taskCategory: string;
  complexityScore: number;
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
}

function modelLabel(model: string): string {
  if (model.includes("opus")) return "Opus";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("haiku")) return "Haiku";
  return model;
}

async function submitRating(taskId: string, rating: number) {
  await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, rating }),
  });
}

export function RecentRequests({ data }: { data: TaskLog[] }) {
  const [ratings, setRatings] = useState<Record<string, number>>({});

  const handleRate = async (taskId: string, rating: number) => {
    setRatings((prev) => ({ ...prev, [taskId]: rating }));
    await submitRating(taskId, rating);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Requests</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Tokens</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rating</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">
                  {new Date(row.createdAt).toLocaleTimeString()}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{row.taskCategory}</Badge>
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
                          onClick={() => handleRate(row.id, star)}
                        >
                          ★
                        </Button>
                      );
                    })}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
