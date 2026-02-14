import { pgTable, uuid, timestamp, varchar, integer, numeric, boolean, index } from "drizzle-orm/pg-core";

export const taskLogs = pgTable(
  "task_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

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
  ]
);

export const budgetConfig = pgTable("budget_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  period: varchar("period", { length: 20 }).notNull(), // 'daily', 'weekly', 'monthly'
  limitUsd: numeric("limit_usd", { precision: 10, scale: 2 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
