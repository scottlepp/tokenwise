"use client";

import { useState, useEffect, useRef } from "react";
import { PROVIDER_COLORS, providerLabel, shortModelLabel } from "@/lib/constants";
import type { ActiveRequest } from "@/lib/active-requests";
import { ChevronDown, ChevronRight, Zap, Clock, Coins, Radio } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface StepLog {
  step: string;
  status: string;
  durationMs: number | null;
  detail: string | null;
  createdAt: string;
}

interface RequestMeta {
  status: string;
  promptPreview: string | null;
  messageCount: number;
  toolCount: number;
  totalLatencyMs: number | null;
  userAgent: string | null;
}

interface FeedEntry {
  id: string;
  createdAt: string;
  requestId: string | null;
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
  dispatchMode: string | null;
  steps: StepLog[];
  request: RequestMeta | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatCost(costUsd: string): string {
  const n = parseFloat(costUsd ?? "0");
  if (n === 0) return "$0";
  if (n < 0.0001) return "<$0.0001";
  return `$${n.toFixed(4)}`;
}

const CATEGORY_ICONS: Record<string, string> = {
  code_gen: "⌨",
  code_review: "🔍",
  debug: "🐛",
  refactor: "♻",
  explain: "💡",
  simple_qa: "💬",
  other: "◦",
};

const DISPATCH_STYLES: Record<string, { label: string; className: string }> = {
  warm: { label: "Warm", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  pinned: { label: "Pinned", className: "bg-blue-50 text-blue-700 border-blue-200" },
  ephemeral: { label: "Ephemeral", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

const STEP_STATUS: Record<string, { dot: string; text: string }> = {
  completed: { dot: "bg-emerald-500", text: "text-emerald-600" },
  error: { dot: "bg-red-500", text: "text-red-600" },
  skipped: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
  started: { dot: "bg-blue-500 animate-pulse", text: "text-blue-600" },
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(iv);
  }, [startedAt]);
  return <span className="tabular-nums">{elapsed}s</span>;
}

function RelativeTimeTick({ isoString }: { isoString: string }) {
  const [label, setLabel] = useState(() => relativeTime(isoString));
  useEffect(() => {
    const iv = setInterval(() => setLabel(relativeTime(isoString)), 5000);
    return () => clearInterval(iv);
  }, [isoString]);
  return <span title={formatTime(isoString)} className="tabular-nums">{label}</span>;
}

function PipelineSteps({ steps }: { steps: StepLog[] }) {
  if (!steps.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {steps.map((s, i) => {
        const st = STEP_STATUS[s.status] ?? { dot: "bg-muted-foreground/40", text: "text-muted-foreground" };
        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded bg-muted border ${st.text}`}
            title={s.detail ?? undefined}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${st.dot}`} />
            {s.step.replace(/_/g, " ")}
            {s.durationMs != null && s.durationMs > 0 && (
              <span className="text-muted-foreground/60">{s.durationMs}ms</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function ComplexityBar({ score }: { score: number }) {
  const color = score < 30 ? "bg-emerald-500" : score < 65 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-1.5" title={`Complexity: ${score}/100`}>
      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">{score}</span>
    </div>
  );
}

// ── Active Request Row ──────────────────────────────────────────────────────────

function ActiveRow({ req }: { req: ActiveRequest }) {
  const color = PROVIDER_COLORS[req.provider] ?? "#8b5cf6";
  const icon = CATEGORY_ICONS[req.category] ?? "◦";

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 border-b hover:bg-muted/30 transition-colors overflow-hidden"
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      {/* Animated live indicator */}
      <div className="flex-shrink-0 mt-1 relative w-3 h-3">
        <span className="absolute inset-0 rounded-full animate-ping opacity-50" style={{ backgroundColor: color }} />
        <span className="absolute inset-0.5 rounded-full" style={{ backgroundColor: color }} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Top row */}
        <div className="flex items-center justify-between gap-4 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-sm font-semibold" style={{ color }}>{providerLabel(req.provider)}</span>
            <span className="text-muted-foreground/40 text-xs">/</span>
            <span className="text-sm font-mono text-foreground">{shortModelLabel(req.model)}</span>
            <span className="text-xs px-1.5 py-0.5 bg-muted rounded font-mono text-muted-foreground">
              {icon} {req.category}
            </span>
          </div>
          <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono flex-shrink-0">
            <Clock className="w-3 h-3" />
            <ElapsedTimer startedAt={req.startedAt} />
          </span>
        </div>

        {/* Prompt preview */}
        {req.promptPreview && (
          <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2 break-words">{req.promptPreview}</p>
        )}

        {/* Streaming output */}
        {req.partialText ? (
          <div className="mt-2 bg-muted border rounded text-xs font-mono text-foreground p-2.5 max-h-20 overflow-y-auto leading-relaxed">
            {req.partialText}
            <span className="inline-block w-1.5 h-3 bg-foreground animate-pulse ml-0.5 align-text-bottom opacity-70" />
          </div>
        ) : (
          <div className="mt-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" />
            awaiting response
          </div>
        )}

        {/* Token counters */}
        {(req.tokensIn > 0 || req.tokensOut > 0) && (
          <div className="flex gap-3 mt-1.5 text-xs text-muted-foreground font-mono">
            {req.tokensIn > 0 && <span>{req.tokensIn.toLocaleString()} in</span>}
            {req.tokensOut > 0 && <span>~{req.tokensOut.toLocaleString()} out</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Completed Request Row ───────────────────────────────────────────────────────

function CompletedRow({ log, isFirst }: { log: FeedEntry; isFirst: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const color = PROVIDER_COLORS[log.provider] ?? "#8b5cf6";
  const cost = parseFloat(log.costUsd ?? "0");
  const promptText = log.promptText ?? log.promptSummary ?? log.request?.promptPreview;
  const icon = CATEGORY_ICONS[log.taskCategory] ?? "◦";
  const dispatch = log.dispatchMode ? DISPATCH_STYLES[log.dispatchMode] : null;
  const hasDetail = !!(log.responseText || log.steps.length > 0);

  return (
    <div
      className={`border-b transition-colors ${isFirst ? "bg-muted/20" : ""} hover:bg-muted/20`}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      {/* Main row */}
      <div
        className={`flex items-start gap-2 px-4 py-2.5 overflow-hidden ${hasDetail ? "cursor-pointer" : ""}`}
        onClick={() => hasDetail && setExpanded(!expanded)}
      >
        {/* Expand chevron */}
        <div className="flex-shrink-0 mt-0.5 w-3.5">
          {hasDetail && (
            expanded
              ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
          )}
        </div>

        {/* Status dot */}
        <div className="flex-shrink-0 mt-1.5">
          {log.cliSuccess
            ? <span className="w-2 h-2 rounded-full bg-emerald-500 block" />
            : <span className="w-2 h-2 rounded-full bg-red-500 block" />
          }
        </div>

        <div className="flex-1 min-w-0">
          {/* Top row: labels left, metrics right — two independent flex children */}
          <div className="flex items-start justify-between gap-4 min-w-0">
            {/* Left: provider / model / category / dispatch */}
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-sm font-semibold" style={{ color }}>
                {providerLabel(log.provider)}
              </span>
              <span className="text-muted-foreground/40 text-xs">/</span>
              <span className="text-sm font-mono text-foreground">{shortModelLabel(log.modelSelected)}</span>
              <span className="text-xs text-muted-foreground font-mono">{icon} {log.taskCategory}</span>
              {dispatch && (
                <span className={`text-xs px-1.5 py-px rounded border font-mono ${dispatch.className}`}>
                  {dispatch.label}
                </span>
              )}
            </div>

            {/* Right: metrics */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono flex-shrink-0">
              <span className="flex items-center gap-1" title={`${log.tokensIn} in / ${log.tokensOut} out`}>
                <Zap className="w-3.5 h-3.5" />
                {(log.tokensIn + log.tokensOut).toLocaleString()}
              </span>
              {cost > 0 && (
                <span className="flex items-center gap-1">
                  <Coins className="w-3.5 h-3.5" />
                  {formatCost(log.costUsd)}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {log.latencyMs >= 1000 ? `${(log.latencyMs / 1000).toFixed(1)}s` : `${log.latencyMs}ms`}
              </span>
              <span className="text-muted-foreground/60">
                <RelativeTimeTick isoString={log.createdAt} />
              </span>
            </div>
          </div>

          {/* Prompt preview */}
          {promptText && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2 break-words">{promptText}</p>
          )}

          {/* Complexity + meta badges */}
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <ComplexityBar score={log.complexityScore} />
            {log.steps.length > 0 && !expanded && (
              <span className="text-xs text-muted-foreground font-mono">
                {log.steps.length} steps
              </span>
            )}
            {log.streaming && (
              <span className="text-xs text-muted-foreground/60 font-mono">stream</span>
            )}
            {log.heuristicScore !== null && (
              <span className={`text-xs font-mono ${log.heuristicScore >= 70 ? "text-emerald-600" : "text-red-500"}`}>
                score {log.heuristicScore}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-9 pb-3 space-y-3 border-t bg-muted/10 pt-2.5 overflow-hidden">
          {log.steps.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Pipeline</div>
              <PipelineSteps steps={log.steps} />
            </div>
          )}

          {log.responseText && (
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Response</div>
              <div className="bg-muted border rounded p-3 text-xs font-mono text-foreground whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                {log.responseText}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="space-y-0.5">
              <div className="text-muted-foreground uppercase tracking-wider text-xs">Tokens In / Out</div>
              <div className="font-mono text-foreground">{log.tokensIn.toLocaleString()} / {log.tokensOut.toLocaleString()}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-muted-foreground uppercase tracking-wider text-xs">Cost</div>
              <div className="font-mono text-foreground">{formatCost(log.costUsd)}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-muted-foreground uppercase tracking-wider text-xs">Latency</div>
              <div className="font-mono text-foreground">{log.latencyMs}ms</div>
            </div>
            {log.request?.messageCount != null && log.request.messageCount > 0 && (
              <div className="space-y-0.5">
                <div className="text-muted-foreground uppercase tracking-wider text-xs">Messages</div>
                <div className="font-mono text-foreground">{log.request.messageCount}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Radio className="w-8 h-8 mb-3 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const [activeList, setActiveList] = useState<ActiveRequest[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function connect() {
      const es = new EventSource("/api/activity/stream");

      es.onopen = () => setConnected(true);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "snapshot") {
            setActiveList(data.active ?? []);
            setFeed(data.feed ?? []);
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        setTimeout(connect, 3000);
      };

      return () => es.close();
    }

    return connect();
  }, []);

  const totalTokens = feed.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0);
  const totalCost = feed.reduce((s, r) => s + parseFloat(r.costUsd ?? "0"), 0);
  const successRate = feed.length > 0
    ? Math.round((feed.filter(r => r.cliSuccess).length / feed.length) * 100)
    : null;

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-3xl font-bold">Live Activity</h1>

        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            {connected && <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75" />}
            <span className={`relative rounded-full h-2 w-2 ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
          </span>
          <span className="text-sm text-muted-foreground">{connected ? "Live" : "Reconnecting…"}</span>
        </div>

        {/* Summary chips */}
        <div className="flex items-center gap-3 ml-auto text-sm text-muted-foreground font-mono flex-wrap">
          {activeList.length > 0 && (
            <span className="text-amber-600 font-medium">{activeList.length} active</span>
          )}
          <span>{feed.length} logged</span>
          {totalTokens > 0 && <span>{(totalTokens / 1000).toFixed(1)}k tokens</span>}
          {totalCost > 0 && <span>${totalCost.toFixed(4)}</span>}
          {successRate !== null && (
            <span className={successRate >= 90 ? "text-emerald-600" : successRate >= 70 ? "text-amber-600" : "text-red-600"}>
              {successRate}% ok
            </span>
          )}
        </div>
      </div>

      {/* ── Active requests ── */}
      {activeList.length > 0 && (
        <div className="rounded-lg border overflow-hidden w-full">
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">
              {activeList.length} in progress
            </span>
          </div>
          {activeList.map((req) => (
            <ActiveRow key={req.taskId} req={req} />
          ))}
        </div>
      )}

      {/* ── Feed ── */}
      <div className="rounded-lg border overflow-hidden w-full" ref={feedRef}>
        {/* Section header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Recent completions
          </span>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" /> ok
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" /> error
            </span>
          </div>
        </div>

        {feed.length === 0 ? (
          <EmptyState message="No requests logged yet — send one to see it here" />
        ) : (
          feed.map((entry, i) => (
            <CompletedRow key={entry.id} log={entry} isFirst={i === 0} />
          ))
        )}
      </div>
    </div>
  );
}
