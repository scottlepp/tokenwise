# Plan: Smart LLM Proxy — OpenAI-Compatible with Multi-Provider Routing & Analytics

## Context

You have accounts with multiple LLM providers — a team Claude account with CLI OAuth (`~/.claude/`), an OpenAI API key, a Google Gemini key, and potentially others. Agentic coding tools like Cline, Aider, Cursor, and Continue support custom OpenAI-compatible endpoints. This proxy bridges them all: it accepts OpenAI-format HTTP requests from any such tool, intelligently picks the **cheapest model across all configured providers** that can handle the task, forwards via the appropriate backend (CLI spawn, HTTP API, etc.), logs everything to PostgreSQL, and provides an analytics dashboard to track credit usage, success rates, and cost savings per provider.

**Provider auth is flexible** — Claude uses the CLI's existing OAuth session (no API key needed), while other providers use standard API keys configured in environment variables.

## Architecture

```
                                    ┌──────────────────────────────────────────────┐
                                    │          Next.js App (localhost:3000)          │
                                    │                                                │
Client ──POST /v1/chat/completions──►  1. Classify task complexity                  │
                                    │  2. Smart Router picks model + provider        │
                                    │     (cross-provider cost optimization)          │
                                    │  3. Dispatch to provider adapter                │
                                    │     ┌─ Claude CLI: claude -p --model <m>       │
                                    │     ├─ OpenAI API: POST /chat/completions      │
                                    │     ├─ Gemini API: POST /generateContent       │
                                    │     ├─ Ollama:     POST /api/chat              │
                                    │     └─ Custom:     configurable HTTP endpoint   │
                                    │  4. Normalize response → OpenAI format          │
                                    │  5. Log to PostgreSQL                           │
                                    │  6. Return OpenAI-format response               │
Client ◄── SSE or JSON response ────┤                                                │
                                    │                                                │
Browser ── GET /dashboard ──────────►  Analytics UI (shadcn + Recharts)              │
                                    │  (per-provider cost breakdown, cross-provider   │
                                    │   success rates, cost savings analysis)          │
                                    └────────────────┬───────────────────────────────┘
                                                     │
                                              ┌──────▼──────┐
                                              │  PostgreSQL  │
                                              │   (Docker)   │
                                              └─────────────┘
```

## Supported Providers

| Provider              | Transport              | Auth                       | Streaming    | Models                                             |
| --------------------- | ---------------------- | -------------------------- | ------------ | -------------------------------------------------- |
| **Claude (CLI)**      | `claude -p` subprocess | OAuth session (~/.claude/) | NDJSON → SSE | opus, sonnet, haiku                                |
| **Claude (API)**      | HTTPS API              | `ANTHROPIC_API_KEY`        | SSE (native) | opus, sonnet, haiku                                |
| **OpenAI**            | HTTPS API              | `OPENAI_API_KEY`           | SSE (native) | gpt-4o, gpt-4o-mini, gpt-4-turbo, o1, o3-mini      |
| **Google Gemini**     | HTTPS API              | `GEMINI_API_KEY`           | SSE          | gemini-2.0-flash, gemini-2.0-pro, gemini-1.5-flash |
| **Ollama**            | HTTP (local)           | None (local)               | NDJSON       | llama3, codellama, mistral, etc.                   |
| **OpenAI-Compatible** | HTTPS API              | Configurable               | SSE          | Any (Groq, Together, Fireworks, etc.)              |

Providers are **opt-in** — only providers with configured credentials are active. The router only considers models from enabled providers.

## Tech Stack

| Layer         | Choice                  | Why                                                    |
| ------------- | ----------------------- | ------------------------------------------------------ |
| Framework     | Next.js 15 (App Router) | API routes + dashboard UI in one app                   |
| Database      | PostgreSQL (Docker)     | Proven, great aggregation queries, Drizzle ORM support |
| ORM           | Drizzle                 | Lightweight, SQL-like, edge-compatible, great TS types |
| Dashboard UI  | shadcn/ui + Tailwind    | Polished components, copy-paste, no runtime deps       |
| Charts        | Recharts                | Lightweight (~60KB), declarative, good defaults        |
| Data fetching | TanStack Query          | Caching, auto-refresh for live dashboard               |

## Project Structure

```
claude-proxy/
├── docker-compose.yml                          # PostgreSQL
├── drizzle.config.ts                           # Drizzle migrations config
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── components.json                             # shadcn/ui config
├── src/
│   ├── app/
│   │   ├── layout.tsx                          # Root layout (dashboard shell)
│   │   ├── page.tsx                            # Redirect to /dashboard
│   │   ├── dashboard/
│   │   │   ├── page.tsx                        # Analytics dashboard
│   │   │   └── components/
│   │   │       ├── cost-over-time.tsx          # Line chart (colored by provider)
│   │   │       ├── model-breakdown.tsx         # Pie chart (grouped by provider)
│   │   │       ├── provider-comparison.tsx     # Side-by-side provider stats
│   │   │       ├── success-rates.tsx           # Bar charts (by provider + model)
│   │   │       ├── request-volume.tsx          # Bar chart
│   │   │       ├── latency-chart.tsx           # Bar chart (by provider)
│   │   │       ├── stats-cards.tsx             # KPI summary cards
│   │   │       ├── recent-requests.tsx         # Table with provider column
│   │   │       ├── cost-savings.tsx            # Cross-provider savings estimate
│   │   │       ├── compression-stats.tsx       # Tokens saved per day
│   │   │       ├── cache-hit-rate.tsx          # Cache hit rate over time
│   │   │       └── budget-gauges.tsx           # Budget usage gauges
│   │   ├── api/
│   │   │   ├── feedback/route.ts               # POST — user rates a response
│   │   │   ├── stats/route.ts                  # GET — dashboard data queries
│   │   │   ├── budget/route.ts                 # GET/PUT — budget config
│   │   │   └── providers/route.ts              # GET/PUT — provider config & status
│   │   └── v1/
│   │       ├── chat/completions/route.ts       # POST — main proxy endpoint
│   │       └── models/route.ts                 # GET — model list (all providers)
│   ├── lib/
│   │   ├── config.ts                           # Provider registry, model catalog, costs
│   │   ├── types.ts                            # OpenAI + internal + provider types
│   │   ├── message-converter.ts                # OpenAI messages[] → provider-specific format
│   │   ├── router.ts                           # Cross-provider smart model selection
│   │   ├── task-classifier.ts                  # Prompt → task category + complexity score
│   │   ├── success-evaluator.ts                # Determine if response succeeded
│   │   ├── cache.ts                            # Response cache (provider-aware)
│   │   ├── compressor.ts                       # Prompt compression pipeline
│   │   ├── budget.ts                           # Token budget manager
│   │   ├── tool-parser.ts                      # Parse tool calls from responses
│   │   ├── utils.ts                            # Shared utilities
│   │   ├── providers/
│   │   │   ├── index.ts                        # Provider interface + registry
│   │   │   ├── base.ts                         # Abstract base provider class
│   │   │   ├── claude-cli.ts                   # Claude via CLI (existing, refactored)
│   │   │   ├── claude-api.ts                   # Claude via Anthropic HTTP API
│   │   │   ├── openai.ts                       # OpenAI HTTP API
│   │   │   ├── gemini.ts                       # Google Gemini HTTP API
│   │   │   ├── ollama.ts                       # Ollama local HTTP API
│   │   │   └── openai-compatible.ts            # Generic OpenAI-compatible endpoint
│   │   ├── stream-transformers/
│   │   │   ├── index.ts                        # Factory: provider → transformer
│   │   │   ├── claude-ndjson.ts                # Claude CLI NDJSON → OpenAI SSE
│   │   │   ├── anthropic-sse.ts                # Anthropic API SSE → OpenAI SSE
│   │   │   ├── openai-passthrough.ts           # OpenAI SSE → passthrough (native)
│   │   │   ├── gemini-sse.ts                   # Gemini SSE → OpenAI SSE
│   │   │   └── ollama-ndjson.ts                # Ollama NDJSON → OpenAI SSE
│   │   ├── compressor/
│   │   │   ├── normalizer.ts                   # Stage 1: whitespace normalization
│   │   │   ├── deduplicator.ts                 # Stage 2: structural deduplication
│   │   │   ├── symbol-table.ts                 # Stage 3: repeated phrase extraction
│   │   │   ├── code-compressor.ts              # Stage 4: code block optimization
│   │   │   └── context-trimmer.ts              # Stage 5: context window trimming
│   │   └── db/
│   │       ├── index.ts                        # Drizzle client
│   │       ├── schema.ts                       # Table definitions (with provider fields)
│   │       └── queries.ts                      # Dashboard query helpers
│   └── components/ui/                          # shadcn/ui components
└── drizzle/                                    # Generated migrations
```

## Provider Abstraction

The core abstraction is the `LLMProvider` interface. Each provider implements this contract, and the proxy dispatches to the correct provider based on the router's decision.

### Provider Interface

```typescript
interface LLMProvider {
  /** Unique provider identifier */
  readonly id: ProviderId; // 'claude-cli' | 'claude-api' | 'openai' | 'gemini' | 'ollama' | 'openai-compatible'

  /** Human-readable display name */
  readonly displayName: string; // 'Claude (CLI)' | 'OpenAI' | etc.

  /** Check if provider is configured and available */
  isAvailable(): boolean;

  /** List models this provider offers (with costs) */
  getModels(): ProviderModel[];

  /** Non-streaming completion */
  complete(params: ProviderRequest): Promise<ProviderResponse>;

  /** Streaming completion — returns a ReadableStream + metadata promise */
  stream(params: ProviderRequest): Promise<ProviderStreamResponse>;

  /** Validate that credentials are working (optional health check) */
  healthCheck?(): Promise<boolean>;
}

interface ProviderModel {
  id: string; // e.g., 'claude-sonnet-4-5-20250929', 'gpt-4o'
  provider: ProviderId;
  displayName: string; // e.g., 'Claude Sonnet 4.5'
  tier: "economy" | "standard" | "premium"; // For cross-provider comparison
  costPerMInputTokens: number; // USD per 1M input tokens
  costPerMOutputTokens: number; // USD per 1M output tokens
  maxContextTokens: number; // Maximum context window
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
}

interface ProviderRequest {
  model: string; // Provider-specific model ID
  messages: ChatMessage[]; // OpenAI-format messages
  systemPrompt?: string;
  stream: boolean;
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
}

interface ProviderResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  finishReason: "stop" | "length" | "tool_calls";
  toolCalls?: ToolCall[];
  rawResponse?: unknown; // Provider-specific raw for debugging
}

interface ProviderStreamResponse {
  stream: ReadableStream<Uint8Array>; // Already in OpenAI SSE format
  metadata: Promise<ProviderResponse>; // Resolves when stream completes
}

type ProviderId =
  | "claude-cli"
  | "claude-api"
  | "openai"
  | "gemini"
  | "ollama"
  | string;
```

### Provider Registry

```typescript
// src/lib/providers/index.ts

class ProviderRegistry {
  private providers: Map<ProviderId, LLMProvider> = new Map();

  /** Register a provider (called at startup based on env vars) */
  register(provider: LLMProvider): void;

  /** Get all enabled providers */
  getEnabled(): LLMProvider[];

  /** Get all available models across all providers */
  getAllModels(): ProviderModel[];

  /** Get a specific provider by ID */
  get(id: ProviderId): LLMProvider | undefined;

  /** Get models sorted by cost (cheapest first) for a given tier */
  getModelsByCost(tier?: "economy" | "standard" | "premium"): ProviderModel[];
}

// Singleton — initialized at app startup from environment config
export const providerRegistry = new ProviderRegistry();
```

### Provider Initialization

Providers are auto-discovered from environment variables at startup:

```typescript
// In providers/index.ts — initializeProviders()

// Claude CLI — always available if `claude` binary exists
if (await commandExists("claude")) registry.register(new ClaudeCliProvider());

// Claude API — if ANTHROPIC_API_KEY is set
if (process.env.ANTHROPIC_API_KEY)
  registry.register(new ClaudeApiProvider(process.env.ANTHROPIC_API_KEY));

// OpenAI — if OPENAI_API_KEY is set
if (process.env.OPENAI_API_KEY)
  registry.register(new OpenAIProvider(process.env.OPENAI_API_KEY));

// Gemini — if GEMINI_API_KEY is set
if (process.env.GEMINI_API_KEY)
  registry.register(new GeminiProvider(process.env.GEMINI_API_KEY));

// Ollama — if OLLAMA_BASE_URL is set (default: http://localhost:11434)
if (
  process.env.OLLAMA_BASE_URL ||
  (await isReachable("http://localhost:11434"))
)
  registry.register(new OllamaProvider(process.env.OLLAMA_BASE_URL));

// Custom OpenAI-compatible — parsed from CUSTOM_PROVIDERS JSON env var
// e.g., CUSTOM_PROVIDERS='[{"id":"groq","baseUrl":"https://api.groq.com/openai/v1","apiKey":"...","models":[...]}]'
if (process.env.CUSTOM_PROVIDERS)
  for (const cfg of JSON.parse(process.env.CUSTOM_PROVIDERS))
    registry.register(new OpenAICompatibleProvider(cfg));
```

## Database Schema

```sql
CREATE TABLE task_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Request info
  task_category VARCHAR(50) NOT NULL,     -- 'simple_qa', 'code_gen', 'code_review', 'debug', 'refactor', 'explain', 'other'
  complexity_score INTEGER NOT NULL,       -- 0-100 from classifier
  prompt_summary VARCHAR(500),             -- First 500 chars for debugging
  message_count  INTEGER NOT NULL,         -- Number of messages in conversation

  -- Provider + Model selection
  provider        VARCHAR(50) NOT NULL,    -- 'claude-cli', 'claude-api', 'openai', 'gemini', 'ollama', etc.
  model_requested VARCHAR(100),            -- What the client asked for (e.g., 'gpt-4o', 'auto')
  model_selected  VARCHAR(100) NOT NULL,   -- Actual model used (e.g., 'claude-sonnet-4-5-20250929')
  router_reason   VARCHAR(200),            -- Why this provider+model was chosen

  -- Response metrics
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  streaming       BOOLEAN NOT NULL DEFAULT false,

  -- Compression metrics
  tokens_before_compression INTEGER,
  tokens_after_compression  INTEGER,
  cache_hit                 BOOLEAN DEFAULT false,
  budget_remaining_usd      NUMERIC(10,2),

  -- Success tracking (three layers)
  cli_success     BOOLEAN NOT NULL DEFAULT true,    -- Provider call succeeded?
  heuristic_score INTEGER,                          -- 0-100 from response heuristics
  user_rating     INTEGER,                          -- 1-5 from optional feedback
  error_message   VARCHAR(500)
);

CREATE INDEX idx_task_logs_created_at ON task_logs (created_at DESC);
CREATE INDEX idx_task_logs_provider ON task_logs (provider);
CREATE INDEX idx_task_logs_model ON task_logs (model_selected);
CREATE INDEX idx_task_logs_category ON task_logs (task_category);
CREATE INDEX idx_task_logs_provider_category ON task_logs (provider, task_category);

CREATE TABLE budget_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period     VARCHAR(20) NOT NULL,                  -- 'daily', 'weekly', 'monthly'
  limit_usd  NUMERIC(10,2) NOT NULL DEFAULT 0,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE provider_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  VARCHAR(50) NOT NULL UNIQUE,          -- 'claude-cli', 'openai', etc.
  display_name VARCHAR(100) NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  priority     INTEGER NOT NULL DEFAULT 0,           -- Higher = preferred when costs are equal
  config_json  JSONB DEFAULT '{}',                   -- Provider-specific config overrides
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Model Name Resolution

The proxy accepts model names in several formats and resolves them to a specific provider + model:

```
Client sends model name
        │
        ▼
┌─ Exact provider model? ──── Yes ──► Use that provider + model
│  (e.g., "gpt-4o", "claude-sonnet-4-5-20250929", "gemini-2.0-flash")
│
├─ Alias? ──── Yes ──► Resolve to provider-specific model
│  (e.g., "opus" → claude-cli/claude-opus-4-6)
│  (e.g., "sonnet" → claude-cli/claude-sonnet-4-5-20250929)
│  (e.g., "haiku" → claude-cli/claude-haiku-4-5-20251001)
│
├─ Tier name? ──── Yes ──► Smart router picks cheapest in tier
│  (e.g., "economy" → cheapest economy-tier model across all providers)
│  (e.g., "standard" → cheapest standard-tier model)
│  (e.g., "premium" → cheapest premium-tier model)
│
├─ "auto" or unknown? ──── Yes ──► Full smart routing
│  (classify task, compare costs across providers, pick optimal)
│
└─ OpenAI legacy name? ──── Yes ──► Map to best equivalent
   (e.g., "gpt-4" → router picks premium tier)
   (e.g., "gpt-3.5-turbo" → router picks economy tier)
```

### Model Tier Classification

Models from all providers are grouped into tiers for cross-provider comparison:

| Tier         | Claude | OpenAI          | Gemini           | Ollama                    |
| ------------ | ------ | --------------- | ---------------- | ------------------------- |
| **Economy**  | Haiku  | gpt-4o-mini     | gemini-2.0-flash | llama3-8b, mistral-7b     |
| **Standard** | Sonnet | gpt-4o          | gemini-2.0-pro   | llama3-70b, codellama-34b |
| **Premium**  | Opus   | o1, gpt-4-turbo | gemini-1.5-pro   | llama3-405b               |

The router picks the cheapest model in the required tier that meets the success threshold.

## Implementation Steps

### Phase 1: Core Proxy (Steps 1–9) ✅ COMPLETE

> Already implemented — Next.js app, PostgreSQL, Claude CLI integration, streaming, smart routing, caching, compression, budget management.

### Phase 5: Multi-Provider Support (Steps 27–36)

#### 27. Create provider abstraction layer

**`src/lib/providers/base.ts`** — Abstract base class:

- Implements shared logic: request validation, timeout handling, retry with exponential backoff
- Abstract methods: `complete()`, `stream()`, `getModels()`, `isAvailable()`
- Concrete methods: `healthCheck()` (default: try a minimal completion), `estimateCost(tokensIn, tokensOut)`

**`src/lib/providers/index.ts`** — Provider registry:

- `ProviderRegistry` class with `register()`, `getEnabled()`, `getAllModels()`, `getModelsByCost()`
- Auto-initialization from environment variables
- Export singleton `providerRegistry`
- `GET /api/providers` endpoint to expose status

#### 28. Refactor Claude CLI into provider adapter

Move `src/lib/claude-cli.ts` → `src/lib/providers/claude-cli.ts`:

- Implement `LLMProvider` interface
- Keep existing spawn logic, CLI arg building, token extraction
- Keep NDJSON parsing for non-streaming
- `isAvailable()`: check if `claude` binary exists on PATH
- `getModels()`: return opus/sonnet/haiku with current pricing

Move `src/lib/stream-transformer.ts` → `src/lib/stream-transformers/claude-ndjson.ts`:

- Same NDJSON → OpenAI SSE transformation
- Exports a function, not the old module-level transform

#### 29. Create Claude API provider

**`src/lib/providers/claude-api.ts`** — Direct Anthropic HTTP API:

- Uses `ANTHROPIC_API_KEY` environment variable
- `POST https://api.anthropic.com/v1/messages` with `anthropic-version: 2023-06-01`
- Handles Anthropic-specific message format (system prompt as top-level field)
- Native SSE streaming (different events from CLI NDJSON)

**`src/lib/stream-transformers/anthropic-sse.ts`**:

- Parse `message_start`, `content_block_delta`, `message_delta`, `message_stop` events
- Transform to OpenAI SSE format

#### 30. Create OpenAI provider

**`src/lib/providers/openai.ts`** — OpenAI HTTP API:

- Uses `OPENAI_API_KEY` environment variable
- `POST https://api.openai.com/v1/chat/completions`
- Native OpenAI format — minimal transformation needed
- Supports function calling, vision, JSON mode

**`src/lib/stream-transformers/openai-passthrough.ts`**:

- OpenAI SSE is already in the target format
- Passthrough with token/cost accumulation for logging

#### 31. Create Gemini provider

**`src/lib/providers/gemini.ts`** — Google Gemini API:

- Uses `GEMINI_API_KEY` environment variable
- `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Streaming: `POST .../{model}:streamGenerateContent?alt=sse`
- Convert OpenAI messages → Gemini `contents[]` format (role mapping: `assistant` → `model`)
- Handle Gemini's `parts[]` content structure

**`src/lib/stream-transformers/gemini-sse.ts`**:

- Parse Gemini SSE events → OpenAI SSE format
- Extract `candidates[0].content.parts[0].text` from each chunk

#### 32. Create Ollama provider

**`src/lib/providers/ollama.ts`** — Ollama local API:

- Uses `OLLAMA_BASE_URL` (default: `http://localhost:11434`)
- `POST /api/chat` with OpenAI-like messages
- Streaming: NDJSON lines with `message.content` field
- `getModels()`: calls `GET /api/tags` to discover locally available models
- Cost: $0 (local inference), but track token counts for analytics

**`src/lib/stream-transformers/ollama-ndjson.ts`**:

- Parse Ollama NDJSON → OpenAI SSE format
- Extract `message.content` from each line

#### 33. Create generic OpenAI-compatible provider

**`src/lib/providers/openai-compatible.ts`** — For Groq, Together, Fireworks, Perplexity, etc.:

- Configurable `baseUrl`, `apiKey`, `models[]`
- Same protocol as OpenAI (SSE streaming, same request/response format)
- `CUSTOM_PROVIDERS` JSON env var for configuration
- Each instance has unique `ProviderId` (e.g., `groq`, `together`)

Configuration format:

```json
[
  {
    "id": "groq",
    "displayName": "Groq",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "gsk_...",
    "models": [
      {
        "id": "llama-3.3-70b-versatile",
        "tier": "standard",
        "costPerMInput": 0.59,
        "costPerMOutput": 0.79,
        "maxContext": 128000
      },
      {
        "id": "mixtral-8x7b-32768",
        "tier": "economy",
        "costPerMInput": 0.24,
        "costPerMOutput": 0.24,
        "maxContext": 32768
      }
    ]
  }
]
```

#### 34. Update model config and types

**`src/lib/config.ts`** — Expanded model catalog:

- Move from flat `MODEL_MAP` to provider-grouped `MODEL_CATALOG`
- Each model entry includes: `provider`, `id`, `tier`, `costIn`, `costOut`, `maxContext`, `capabilities`
- Legacy model name aliases still work (`gpt-4` → tier lookup)
- `AVAILABLE_MODELS` is now dynamic: union of all enabled providers' models

**`src/lib/types.ts`** — New types:

```typescript
type ProviderId =
  | "claude-cli"
  | "claude-api"
  | "openai"
  | "gemini"
  | "ollama"
  | string;

interface RouterDecision {
  provider: ProviderId; // NEW: which provider to use
  model: string; // Provider-specific model ID
  alias: string; // Display alias (e.g., 'sonnet')
  reason: string; // Why this provider+model was chosen
  category: TaskCategory;
  complexityScore: number;
}

interface TaskLogInsert {
  provider: string; // NEW: provider used
  // ... all existing fields
}
```

#### 35. Update router for cross-provider selection

**`src/lib/router.ts`** — Cross-provider smart routing:

**New decision flow:**

1. **Explicit model**: If user specifies a known model from any provider → use that provider + model
2. **Explicit provider prefix**: Support `provider:model` syntax (e.g., `openai:gpt-4o`, `gemini:gemini-2.0-flash`)
3. **Classify task** → get category + complexity score
4. **Determine required tier** from complexity score:
   - Score 0–25 → economy tier
   - Score 26–60 → standard tier
   - Score 61–100 → premium tier
5. **Cross-provider selection** (within the required tier):
   a. Get all models in the tier from enabled providers
   b. For each model: look up historical success rate for this task category (past 7 days)
   c. Filter: success rate ≥ 80% threshold (or no history = eligible)
   d. Filter: no 3+ consecutive failures for this category
   e. Sort by cost (cheapest first), then by provider priority
   f. Pick the cheapest model that passes all filters
6. **Fallback**: If no model passes, escalate to next tier up
7. **Budget-aware**: If budget is tight (≥80%), prefer cheaper providers/models

**Router logs** include provider in `router_reason`: `"openai/gpt-4o-mini: cheapest economy model, 92% success for code_gen"`

#### 36. Update completions endpoint for multi-provider dispatch

**`src/app/v1/chat/completions/route.ts`** — Updated pipeline:

```
1. Parse & validate request body
2. Check for /feedback command → handle locally
3. Check dedup window (5s TTL)
4. Route to provider + model
   - Call selectModel() → { provider, model, reason, category, complexityScore }
   - Agentic client upgrade: economy → standard tier
5. Budget check (provider-aware costs)
6. Cache check (keyed by provider + model + messages)
7. Compress messages
8. Get provider from registry
9. Dispatch to provider
   - Streaming:  provider.stream(request) → ReadableStream
   - Non-streaming: provider.complete(request) → ProviderResponse
10. Evaluate success (provider-agnostic heuristics)
11. Log to database (with provider field)
12. Return OpenAI-format response
    Headers: x-task-id, x-provider, x-model, x-router-reason, x-tokens-saved, x-cache-hit
```

### Phase 6: Dashboard Updates for Multi-Provider (Steps 37–40)

#### 37. Update DB queries for provider awareness

**`src/lib/db/queries.ts`** — Add provider dimension to all queries:

- `getCostByProvider(days)` — cost breakdown per provider
- `getModelBreakdown(days)` — now grouped by provider → model
- `getSuccessRates(days)` — success rates by provider and by provider+model
- `getProviderLatency(days)` — average latency per provider
- `getProviderComparison(days)` — side-by-side: cost, latency, success per provider
- Update existing queries to include `provider` in grouping

#### 38. Create provider comparison dashboard widget

**`src/app/dashboard/components/provider-comparison.tsx`**:

- Side-by-side cards for each active provider
- Metrics: total requests, total cost, avg latency, success rate, avg tokens
- Sparkline charts for each metric over time
- Color-coded by provider (consistent colors across all charts)

#### 39. Update existing dashboard charts

- **Cost over time**: Stack by provider (each provider a different color)
- **Model breakdown**: Group by provider, then by model within provider
- **Success rates**: Add provider filter dropdown
- **Latency chart**: Group by provider
- **Recent requests table**: Add "Provider" column, provider filter
- **Stats cards**: Add "Providers Active" card

#### 40. Create provider management API + UI

**`src/app/api/providers/route.ts`**:

- `GET /api/providers` — list all providers with status (enabled, model count, health)
- `PUT /api/providers/:id` — enable/disable, set priority, update config

**Dashboard settings page** (optional, can be Phase 7):

- Toggle providers on/off
- Set provider priority (tiebreaker when costs are equal)
- View provider health status
- Test provider connectivity

### Phase 7: Advanced Cross-Provider Features (Steps 41–44)

#### 41. Provider fallback chains

When a provider fails, automatically retry with the next cheapest provider:

```typescript
interface FallbackConfig {
  maxRetries: number; // Default: 2
  retryableErrors: string[]; // 'rate_limit', 'timeout', 'server_error'
  escalateOnFailure: boolean; // Try next tier if all same-tier fail
}
```

- Rate limit (429) from OpenAI → try Gemini or Claude
- Timeout → try a different provider
- Server error (500) → try next provider
- Log all attempts in `task_logs` (primary + fallback entries linked by `request_group_id`)

#### 42. Provider-specific message conversion

**`src/lib/message-converter.ts`** — Provider-aware conversion:

| Feature       | Claude CLI             | Claude API               | OpenAI                    | Gemini                     | Ollama                |
| ------------- | ---------------------- | ------------------------ | ------------------------- | -------------------------- | --------------------- |
| System prompt | `--system-prompt` flag | Top-level `system` field | `role: "system"` message  | `system_instruction` field | `system` field        |
| Multi-turn    | Flatten to text        | Native messages array    | Native messages array     | Native contents array      | Native messages array |
| Vision        | Not supported (CLI)    | `image` content blocks   | `image_url` content parts | `inline_data` parts        | `images` field        |
| Tools         | XML in prompt          | Native tool_use          | Native functions          | `function_declarations`    | Not supported         |

Each provider adapter handles its own message format conversion internally.

#### 43. Unified token counting and cost calculation

Different providers report tokens differently:

- **Claude CLI**: `modelUsage` with cache tokens
- **Claude API**: `usage.input_tokens`, `usage.output_tokens`
- **OpenAI**: `usage.prompt_tokens`, `usage.completion_tokens`
- **Gemini**: `usageMetadata.promptTokenCount`, `usageMetadata.candidatesTokenCount`
- **Ollama**: `eval_count`, `prompt_eval_count`

Each provider adapter normalizes to `{ tokensIn, tokensOut, costUsd }` in its response.

#### 44. A/B testing across providers

Optional feature: split traffic between providers for the same task category to continuously compare quality:

```typescript
interface ABTestConfig {
  enabled: boolean;
  splitPercentage: number; // % of requests to send to challenger
  challengerProvider: ProviderId;
  challengerModel: string;
  baselineProvider: ProviderId;
  baselineModel: string;
  taskCategories: TaskCategory[]; // Which categories to test
}
```

- Log both results, compare heuristic scores
- Dashboard shows A/B test results: success rate, cost, latency per variant
- Auto-promote challenger if it outperforms baseline at lower cost

## Environment Variables

```bash
# Database (required)
DATABASE_URL=postgresql://claude:claude@localhost:5432/claude_proxy

# Claude CLI (auto-detected — no config needed if `claude` is on PATH)
# Uses OAuth tokens from ~/.claude/

# Claude API (optional — direct API access, faster than CLI)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (optional)
OPENAI_API_KEY=sk-...

# Google Gemini (optional)
GEMINI_API_KEY=AIza...

# Ollama (optional — auto-detected on localhost:11434)
OLLAMA_BASE_URL=http://localhost:11434

# Custom OpenAI-compatible providers (optional)
CUSTOM_PROVIDERS='[{"id":"groq","displayName":"Groq","baseUrl":"https://api.groq.com/openai/v1","apiKey":"gsk_...","models":[{"id":"llama-3.3-70b-versatile","tier":"standard","costPerMInput":0.59,"costPerMOutput":0.79,"maxContext":128000}]}]'

# Router defaults
DEFAULT_PROVIDER=claude-cli          # Preferred provider when costs are equal
SUCCESS_THRESHOLD=0.8                # Minimum success rate to use a model (0-1)
CONSECUTIVE_FAILURE_LIMIT=3          # Skip model after N consecutive failures

# Optional
LLM_CLASSIFIER=true                  # Use LLM for task classification (costs ~$0.001/request)
```

## Key Design Decisions

- **Provider abstraction**: All providers implement `LLMProvider` interface. Adding a new provider = one file + register in init.
- **Cross-provider cost optimization**: Router compares costs across ALL enabled providers, not just within one. A $0 Ollama response beats a $0.003 Haiku response for simple tasks.
- **Tier-based routing**: Models grouped into economy/standard/premium tiers for fair cross-provider comparison. Complexity score determines required tier, then cheapest model in tier wins.
- **Graceful degradation**: If a provider goes down, others automatically take over. No single point of failure beyond the proxy itself.
- **CLI + API for Claude**: Both Claude transports supported. CLI uses OAuth (no API key), API is faster. Users choose based on their setup.
- **Backward compatible**: Existing Claude-only configs continue to work unchanged. `model: "sonnet"` still works.
- **Provider prefix syntax**: `openai:gpt-4o` explicitly pins a provider. Useful when you want a specific provider regardless of routing.
- **Zero-cost local models**: Ollama models are $0 cost, making them the default choice for simple tasks when available.
- **Client-agnostic**: Works with any tool that supports OpenAI-compatible endpoints — Cline, Aider, Cursor, Continue, etc.
- **Three-layer success tracking**: Provider call success (automatic) + response heuristics (automatic) + user feedback (optional). Routing learns from all three, per provider.
- **Stateless proxy**: Each request dispatches to a fresh provider call. Multi-turn context is in the messages array.
- **Dashboard is in-app**: Same Next.js app serves proxy API + analytics UI with per-provider breakdowns.

## Client Configuration

Any agentic coding tool that supports OpenAI-compatible endpoints can use this proxy.

### Cursor

```
Settings > Models > OpenAI API:
  Base URL:  http://localhost:3000/v1
  API Key:   sk-local          (any non-empty string — proxy ignores auth)
  Model:     auto               (smart routing across all providers)
             sonnet             (explicit Claude Sonnet)
             gpt-4o             (explicit OpenAI GPT-4o)
             openai:gpt-4o      (explicit provider + model)
             economy            (cheapest economy-tier model)
```

### Cline (VS Code)

```
Settings > Cline > API Provider: OpenAI Compatible
  Base URL:  http://localhost:3000/v1
  API Key:   sk-local
  Model:     auto               (or any model/tier/provider:model)
```

### Aider

```bash
aider --openai-api-base http://localhost:3000/v1 --openai-api-key sk-local --model auto
```

### Continue (VS Code)

```json
{
  "models": [
    {
      "provider": "openai",
      "title": "LLM Proxy (Auto)",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "sk-local",
      "model": "auto"
    },
    {
      "provider": "openai",
      "title": "LLM Proxy (Local Ollama)",
      "apiBase": "http://localhost:3000/v1",
      "apiKey": "sk-local",
      "model": "ollama:llama3"
    }
  ]
}
```

## Verification

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Push schema
npx drizzle-kit push

# 3. Start the proxy
npm run dev

# 4. Test models endpoint (lists models from ALL enabled providers)
curl http://localhost:3000/v1/models

# 5. Test auto-routing (picks cheapest provider)
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"What is 2+2?"}]}'

# 6. Test explicit OpenAI routing
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"openai:gpt-4o","messages":[{"role":"user","content":"Hello"}],"stream":true}'

# 7. Test tier-based routing
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"economy","messages":[{"role":"user","content":"What is the capital of France?"}]}'

# 8. Check provider status
curl http://localhost:3000/api/providers

# 9. Check dashboard with provider breakdown
open http://localhost:3000/dashboard

# 10. Rate a response
curl -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<uuid>","rating":5}'

# 11. Test provider fallback (simulate by disabling a provider)
curl -X PUT http://localhost:3000/api/providers/openai \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}'
```
