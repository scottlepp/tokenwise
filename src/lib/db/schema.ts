import { pgTable, uuid, timestamp, varchar, integer, numeric, boolean, text, index } from "drizzle-orm/pg-core";

// ── Request Logs: one row per incoming HTTP request ──
export const requestLogs = pgTable(
  "request_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // Client info
    userAgent: varchar("user_agent", { length: 500 }),
    clientIp: varchar("client_ip", { length: 50 }),

    // Request details
    modelRequested: varchar("model_requested", { length: 100 }),
    messageCount: integer("message_count").notNull().default(0),
    toolCount: integer("tool_count").notNull().default(0),
    streaming: boolean("streaming").notNull().default(false),
    promptPreview: varchar("prompt_preview", { length: 500 }),

    // Final status
    status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, processing, completed, error, cached, deduped
    completedAt: timestamp("completed_at", { withTimezone: true }),
    totalLatencyMs: integer("total_latency_ms"),
    httpStatus: integer("http_status"),
    errorMessage: varchar("error_message", { length: 500 }),
  },
  (table) => [
    index("idx_request_logs_created_at").on(table.createdAt),
    index("idx_request_logs_status").on(table.status),
  ]
);

// ── Status Logs: many rows per request, one per pipeline step ──
export const statusLogs = pgTable(
  "status_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull().references(() => requestLogs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    // Step info
    step: varchar("step", { length: 50 }).notNull(), // e.g. classify, route, compress, budget_check, cli_spawn, cli_streaming, cli_done, tool_parse, response_sent
    status: varchar("status", { length: 20 }).notNull(), // started, completed, error, skipped
    durationMs: integer("duration_ms"),
    detail: text("detail"), // JSON or free-form detail about this step
  },
  (table) => [
    index("idx_status_logs_request_id").on(table.requestId),
    index("idx_status_logs_created_at").on(table.createdAt),
  ]
);

// ── Task Logs: final summary per completed request (existing table) ──
export const taskLogs = pgTable(
  "task_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    requestId: uuid("request_id").references(() => requestLogs.id),

    // Request info
    taskCategory: varchar("task_category", { length: 50 }).notNull(),
    complexityScore: integer("complexity_score").notNull(),
    promptSummary: varchar("prompt_summary", { length: 500 }),
    messageCount: integer("message_count").notNull(),

    // Model selection
    modelRequested: varchar("model_requested", { length: 100 }),
    modelSelected: varchar("model_selected", { length: 100 }).notNull(),
    routerReason: varchar("router_reason", { length: 200 }),

    // Response metrics
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
    latencyMs: integer("latency_ms").notNull().default(0),
    streaming: boolean("streaming").notNull().default(false),

    // Compression & cache
    tokensBeforeCompression: integer("tokens_before_compression"),
    tokensAfterCompression: integer("tokens_after_compression"),
    cacheHit: boolean("cache_hit").default(false),
    budgetRemainingUsd: numeric("budget_remaining_usd", { precision: 10, scale: 2 }),

    // Success tracking
    cliSuccess: boolean("cli_success").notNull().default(true),
    heuristicScore: integer("heuristic_score"),
    userRating: integer("user_rating"),
    errorMessage: varchar("error_message", { length: 500 }),
  },
  (table) => [
    index("idx_task_logs_created_at").on(table.createdAt),
    index("idx_task_logs_model").on(table.modelSelected),
    index("idx_task_logs_category").on(table.taskCategory),
    index("idx_task_logs_request_id").on(table.requestId),
  ]
);

export const budgetConfig = pgTable("budget_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  period: varchar("period", { length: 20 }).notNull(), // 'daily', 'weekly', 'monthly'
  limitUsd: numeric("limit_usd", { precision: 10, scale: 2 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
