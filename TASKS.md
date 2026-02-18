# Tasks — Smart Claude Proxy

## Phase 1: Core Proxy

- [x] **1. Bootstrap project**
  - [x] Run `create-next-app` with TypeScript, App Router, Tailwind, src dir
  - [x] Init shadcn/ui
  - [x] Install deps: `drizzle-orm`, `postgres`, `recharts`, `@tanstack/react-query`
  - [x] Install dev deps: `drizzle-kit`
  - [x] Verify `npm run dev` works

- [x] **2. Docker + Database setup**
  - [x] Create `docker-compose.yml` (PostgreSQL 17)
  - [x] Create `.env.local` with `DATABASE_URL`
  - [x] Create `drizzle.config.ts`
  - [x] Create `src/lib/db/schema.ts` (`task_logs` + `budget_config` tables)
  - [x] Create `src/lib/db/index.ts` (Drizzle client)
  - [ ] Run `docker compose up -d` and `drizzle-kit push`

- [x] **3. Create `src/lib/types.ts`**
  - [x] OpenAI types: `ChatCompletionRequest`, `ChatCompletionResponse`, `ChatCompletionChunk`
  - [x] Internal types: `TaskCategory`, `RouterDecision`, `TaskLog`

- [x] **4. Create `src/lib/config.ts`**
  - [x] Model name mapping (OpenAI names → Claude names)
  - [x] Cost-per-model table (input/output per 1M tokens)
  - [x] Available models list for `/v1/models`

- [x] **5. Create `src/lib/message-converter.ts`**
  - [x] Extract system messages → `--system-prompt`
  - [x] Single user message passthrough
  - [x] Multi-turn flattening with `[User]`/`[Assistant]` labels
  - [x] Handle `content` as string or `ContentPart[]`

- [x] **6. Create `src/lib/claude-cli.ts`**
  - [x] Build CLI args (`-p`, `--output-format`, `--model`, etc.)
  - [x] Non-streaming: spawn, collect stdout, parse JSON
  - [x] Streaming: spawn and return `ChildProcess`
  - [x] Long prompt handling (>100KB via stdin)
  - [x] Error handling: `ENOENT`, non-zero exit, `is_error`

- [x] **7. Create `src/lib/stream-transformer.ts`**
  - [x] `TransformStream` for Claude NDJSON → OpenAI SSE
  - [x] Partial line buffering
  - [x] Parse `message_start`, `content_block_delta`, `message_delta`
  - [x] Flush `data: [DONE]\n\n`
  - [x] Accumulate full response text + token counts for logging

- [x] **8. Create `src/app/v1/chat/completions/route.ts`**
  - [x] Parse and validate request body
  - [x] Call task classifier + model router
  - [x] Spawn CLI (streaming and non-streaming paths)
  - [x] Log result to PostgreSQL
  - [x] Return OpenAI-format response with `x-task-id` header
  - [x] Handle stream cancellation (`child.kill()`)

- [x] **9. Create `src/app/v1/models/route.ts`**
  - [x] Return available models in OpenAI list format

- [ ] **Milestone: curl test — non-streaming and streaming completions work**

---

## Phase 2: Smart Routing

- [x] **10. Create `src/lib/task-classifier.ts`**
  - [x] Keyword-based category detection (simple_qa, code_gen, code_review, debug, refactor, explain, other)
  - [x] Complexity scoring (0–100) based on token count, code blocks, keywords, turns, system prompt

- [x] **11. Create `src/lib/router.ts`**
  - [x] Respect explicit Claude model names from user
  - [x] Look up historical success rates per category from DB
  - [x] Pick cheapest model above success threshold (80%)
  - [x] Fallback to complexity-score tiers when no history
  - [x] Consecutive failure detection (3+ failures → skip model)
  - [x] Log routing reason

- [x] **12. Create `src/lib/success-evaluator.ts`**
  - [x] Layer 1: CLI exit code check
  - [x] Layer 2: Response heuristics (empty, too short, refusal phrases, code presence)
  - [x] Layer 3: User feedback integration (from `/feedback` command or dashboard)
  - [x] Combined success function for routing decisions

- [x] **13. In-chat `/feedback` command**
  - [x] Intercept messages starting with `/feedback` before forwarding to Claude
  - [x] Parse syntax: `/feedback good|bad [taskId]` or `/feedback 1-5 [taskId]`
  - [x] `good` → rating 5, `bad` → rating 1, numeric 1-5 → exact rating
  - [x] No taskId → rate most recent task (query DB for latest by `created_at`)
  - [x] With taskId → rate specific task (supports partial UUID match)
  - [x] Update `user_rating` in DB
  - [x] Return synthetic OpenAI response confirming: task summary, model used, new rating
  - [x] No Claude CLI call — entirely handled by the proxy

- [x] **14. Wire routing into completions endpoint**
  - [x] Call `router.selectModel()` before spawning CLI
  - [x] Call `successEvaluator.evaluate()` after response
  - [x] Persist full task log to DB

- [ ] **Milestone: smart routing picks haiku for "What is 2+2?" and opus for complex code tasks**
- [ ] **Milestone: `/feedback good` in Cursor chat confirms rating on most recent task**

---

## Phase 2.5: Cost Optimization

- [x] **15. Create `src/lib/cache.ts` — Response Cache**
  - [x] SHA-256 exact-match cache keyed on `(model + system_prompt + all_messages)`
  - [x] In-memory Map with configurable TTL (default 60s)
  - [x] On hit: return cached response, log as `cache_hit = true`, zero CLI cost
  - [x] On miss: proceed through pipeline, store successful result in cache
  - [x] Dedup window: hash of `(last_user_message)` only, 5s TTL, catches Cursor duplicate sends
  - [x] Never cache `/feedback` commands
  - [x] Cache key includes model to prevent cross-polluting routes

- [x] **16. Create `src/lib/compressor.ts` + `src/lib/compressor/` — Prompt Compressor**
  - [x] **Stage 1 — Normalizer** (`compressor/normalizer.ts`)
    - [x] Collapse multiple whitespace/blank lines to single
    - [x] Normalize bullet styles (`*`, `-`, `•` → `-`)
    - [x] Strip trailing whitespace per line
    - [x] Never change wording, reorder, or remove content
  - [x] **Stage 2 — Structural Deduplicator** (`compressor/deduplicator.ts`)
    - [x] Hash semantic blocks: `sha256(block_kind + block_content)`
    - [x] First occurrence kept, duplicates replaced with `[ref:block:<hash_prefix>]`
    - [x] Inject expansion table at top of system prompt
    - [x] Preserve Cursor's `<context>`, `<file>` tag structure
  - [x] **Stage 3 — Symbol Table** (`compressor/symbol-table.ts`)
    - [x] Detect phrases repeated 3+ times across messages (min 20 chars)
    - [x] Extract to named symbols, inject definitions block once at top
    - [x] Replace later occurrences with symbol reference
  - [x] **Stage 4 — Code Compressor** (`compressor/code-compressor.ts`)
    - [x] Collapse blank lines within code blocks
    - [x] Strip trailing whitespace in code
    - [x] Deduplicate identical code blocks across messages
    - [x] Never: minify identifiers, rename variables, reorder imports
  - [x] **Stage 5 — Context Trimmer** (`compressor/context-trimmer.ts`)
    - [x] If tokens > threshold (50K): keep last 4 turns in full, summarize older turns
    - [x] Drop assistant turns older than 8 turns (keep user turn summaries)
    - [x] Replace old code blocks with `[code block: N lines of filename]`
    - [x] Never drop: latest user message, system instructions, open file context
  - [x] **Pipeline orchestrator** (`compressor.ts`)
    - [x] Run stages sequentially, skip any stage that throws (fail open)
    - [x] Track `tokens_before_compression` and `tokens_after_compression`

- [x] **17. Create `src/lib/budget.ts` — Token Budget Manager**
  - [x] Read budget config from `budget_config` DB table
  - [x] Query `task_logs` for current period spend (daily/weekly/monthly)
  - [x] Normal routing when `< 80%` of budget
  - [x] Force model downgrade (opus→sonnet, sonnet→haiku) at `>= 80%`
  - [x] Reject with 429 at `>= 100%` (hard stop)
  - [x] Snapshot `budget_remaining_usd` in task log
  - [x] `GET /api/budget` — current config + usage
  - [x] `PUT /api/budget` — update limits from dashboard

- [x] **18. Wire cost optimization into pipeline**
  - [x] Insert cache → compressor → budget checks in `completions/route.ts`
  - [x] Log compression metrics in task_logs (tokens before/after, cache_hit)
  - [x] Add `x-cache-hit` and `x-tokens-saved` response headers
  - [x] Update DB schema: add compression + budget columns to task_logs

- [x] **19. Update DB schema for cost optimization**
  - [x] Add `tokens_before_compression`, `tokens_after_compression`, `cache_hit`, `budget_remaining_usd` to task_logs
  - [x] Create `budget_config` table
  - [ ] Run `drizzle-kit push`

- [ ] **Milestone: duplicate curl requests return cached response instantly**
- [ ] **Milestone: compressed prompt is shorter than original (check `x-tokens-saved` header)**
- [ ] **Milestone: requests blocked with 429 when budget exceeded**

---

## Phase 3: Dashboard

- [x] **20. Create `src/lib/db/queries.ts`**
  - [x] `getCostOverTime(days)`
  - [x] `getModelBreakdown(days)`
  - [x] `getSuccessRates(days)` (by model + by category)
  - [x] `getRequestVolume(days)`
  - [x] `getLatencyByModel(days)`
  - [x] `getRecentRequests(limit, offset)`
  - [x] `getCostSavings(days)`
  - [x] `getSummaryStats(days)`
  - [x] `getCompressionStats(days)`
  - [x] `getCacheHitRate(days)`
  - [x] `getBudgetUsage()`

- [x] **21. Create `src/app/api/stats/route.ts`**
  - [x] `GET /api/stats?days=7&metric=<name>` parameterized queries
  - [x] JSON responses for each chart widget

- [x] **22. Create `src/app/api/feedback/route.ts`**
  - [x] `POST /api/feedback` with `{ taskId, rating }`
  - [x] Validate input and update `user_rating` in DB
  - [x] Shared logic with `/feedback` chat command

- [x] **23. Create dashboard page `src/app/dashboard/page.tsx`**
  - [x] Stats cards row (total requests, total cost, avg latency, success rate, tokens saved, cache hits)
  - [x] Cost over time (line chart)
  - [x] Model breakdown (donut chart)
  - [x] Success rate by model (bar chart)
  - [x] Success rate by category (bar chart)
  - [x] Request volume (bar chart)
  - [x] Latency by model (bar chart)
  - [x] Cost savings estimate card (actual vs all-opus)
  - [x] Compression stats (tokens saved per day, stacked bar by stage)
  - [x] Cache hit rate (line chart over time)
  - [x] Budget gauges (daily/weekly/monthly with green/yellow/red zones)
  - [x] Recent requests table (sortable: time, category, model, tokens, compression ratio, cost, success, rating)

- [x] **24. Feedback UI in recent requests table**
  - [x] Star rating or thumbs up/down per row
  - [x] Sends `POST /api/feedback` on click

- [ ] **Milestone: dashboard loads at localhost:3000/dashboard with live data + cost optimization widgets**

---

## Phase 4: Docker & Polish

- [x] **25. Docker setup**
  - [x] `docker-compose.yml` with PostgreSQL
  - [ ] Optional: add Next.js app as a Docker service
  - [ ] Verify `docker compose up` brings up everything

- [x] **26. Clean up & polish**
  - [x] Remove create-next-app boilerplate
  - [x] `.env.local` template
  - [x] Auto-redirect `/` → `/dashboard`
  - [ ] README with setup + Cursor config instructions

- [ ] **Milestone: fresh clone → `docker compose up` → `npm run dev` → working proxy + dashboard**

---

## Phase 5: Multi-Provider Support

- [ ] **27. Create provider abstraction layer**
  - [ ] Create `src/lib/providers/base.ts` — abstract base class with shared logic (validation, timeout, retry)
  - [ ] Create `src/lib/providers/index.ts` — `ProviderRegistry` class with `register()`, `getEnabled()`, `getAllModels()`, `getModelsByCost()`
  - [ ] Auto-initialization from environment variables
  - [ ] Export singleton `providerRegistry`

- [ ] **28. Refactor Claude CLI into provider adapter**
  - [ ] Move `src/lib/claude-cli.ts` → `src/lib/providers/claude-cli.ts`
  - [ ] Implement `LLMProvider` interface (keep existing spawn logic)
  - [ ] `isAvailable()`: check if `claude` binary exists on PATH
  - [ ] `getModels()`: return opus/sonnet/haiku with current pricing
  - [ ] Move `src/lib/stream-transformer.ts` → `src/lib/stream-transformers/claude-ndjson.ts`
  - [ ] Create `src/lib/stream-transformers/index.ts` — factory: provider → transformer
  - [ ] Update imports across codebase

- [ ] **29. Create Claude API provider**
  - [ ] Create `src/lib/providers/claude-api.ts` — Anthropic HTTP API (`ANTHROPIC_API_KEY`)
  - [ ] `POST https://api.anthropic.com/v1/messages` with proper headers
  - [ ] Handle Anthropic message format (system as top-level field)
  - [ ] Create `src/lib/stream-transformers/anthropic-sse.ts` — parse Anthropic SSE → OpenAI SSE
  - [ ] Non-streaming and streaming paths

- [ ] **30. Create OpenAI provider**
  - [ ] Create `src/lib/providers/openai.ts` — OpenAI HTTP API (`OPENAI_API_KEY`)
  - [ ] `POST https://api.openai.com/v1/chat/completions` — native format
  - [ ] Create `src/lib/stream-transformers/openai-passthrough.ts` — passthrough with token accumulation
  - [ ] Support function calling, vision, JSON mode

- [ ] **31. Create Gemini provider**
  - [ ] Create `src/lib/providers/gemini.ts` — Google Gemini API (`GEMINI_API_KEY`)
  - [ ] Convert OpenAI messages → Gemini `contents[]` format
  - [ ] Handle streaming via `streamGenerateContent?alt=sse`
  - [ ] Create `src/lib/stream-transformers/gemini-sse.ts` — Gemini SSE → OpenAI SSE

- [ ] **32. Create Ollama provider**
  - [ ] Create `src/lib/providers/ollama.ts` — Ollama local API (`OLLAMA_BASE_URL`)
  - [ ] `POST /api/chat` with messages, `GET /api/tags` for model discovery
  - [ ] Create `src/lib/stream-transformers/ollama-ndjson.ts` — Ollama NDJSON → OpenAI SSE
  - [ ] Cost: $0 (local), track token counts for analytics

- [ ] **33. Create generic OpenAI-compatible provider**
  - [ ] Create `src/lib/providers/openai-compatible.ts` — configurable `baseUrl`, `apiKey`, `models[]`
  - [ ] Parse `CUSTOM_PROVIDERS` JSON env var for configuration
  - [ ] Each instance gets unique `ProviderId` (e.g., `groq`, `together`)
  - [ ] Reuse OpenAI passthrough stream transformer

- [ ] **34. Update model config and types**
  - [ ] Expand `src/lib/config.ts` — provider-grouped `MODEL_CATALOG` with tier/cost/capabilities
  - [ ] Update `src/lib/types.ts` — add `ProviderId`, update `RouterDecision` with `provider` field
  - [ ] Dynamic `AVAILABLE_MODELS` from enabled providers
  - [ ] Legacy model name aliases still work (`gpt-4` → tier lookup)

- [ ] **35. Update router for cross-provider selection**
  - [ ] Support explicit `provider:model` syntax (e.g., `openai:gpt-4o`)
  - [ ] Recognize models from any provider (not just Claude)
  - [ ] Cross-provider tier-based selection (cheapest model in required tier)
  - [ ] Historical success rate lookup per provider+model+category
  - [ ] Budget-aware provider preference (≥80% budget → prefer cheaper providers)
  - [ ] Router reason includes provider: `"openai/gpt-4o-mini: cheapest economy, 92% success"`

- [ ] **36. Update completions endpoint for multi-provider dispatch**
  - [ ] Dispatch to provider adapter instead of direct Claude CLI spawn
  - [ ] Add `x-provider` and `x-model` response headers
  - [ ] Cache keys include provider
  - [ ] Log `provider` field in task_logs
  - [ ] Update DB schema: add `provider` column to task_logs

- [ ] **Milestone: `curl` with `model: "openai:gpt-4o"` routes to OpenAI, `model: "auto"` picks cheapest**
- [ ] **Milestone: `/v1/models` returns models from all enabled providers**

---

## Phase 6: Dashboard Updates for Multi-Provider

- [ ] **37. Update DB queries for provider awareness**
  - [ ] `getCostByProvider(days)` — cost breakdown per provider
  - [ ] `getModelBreakdown(days)` — grouped by provider → model
  - [ ] `getSuccessRates(days)` — by provider and provider+model
  - [ ] `getProviderLatency(days)` — avg latency per provider
  - [ ] `getProviderComparison(days)` — side-by-side stats
  - [ ] Update existing queries to include `provider` in grouping

- [ ] **38. Create provider comparison dashboard widget**
  - [ ] `src/app/dashboard/components/provider-comparison.tsx`
  - [ ] Side-by-side cards for each active provider
  - [ ] Metrics: total requests, total cost, avg latency, success rate
  - [ ] Color-coded by provider (consistent colors across all charts)

- [ ] **39. Update existing dashboard charts**
  - [ ] Cost over time: stack by provider
  - [ ] Model breakdown: group by provider
  - [ ] Success rates: add provider filter dropdown
  - [ ] Latency chart: group by provider
  - [ ] Recent requests table: add "Provider" column + filter
  - [ ] Stats cards: add "Providers Active" card

- [ ] **40. Create provider management API + UI**
  - [ ] `GET /api/providers` — list all providers with status
  - [ ] `PUT /api/providers/:id` — enable/disable, set priority
  - [ ] Add `provider_config` table to DB schema
  - [ ] Run `drizzle-kit push` for schema changes

- [ ] **Milestone: dashboard shows per-provider cost breakdown and comparison charts**

---

## Phase 7: Advanced Cross-Provider Features

- [ ] **41. Provider fallback chains**
  - [ ] Auto-retry with next cheapest provider on failure (rate limit, timeout, server error)
  - [ ] Configurable max retries and retryable error types
  - [ ] Escalate to next tier if all same-tier providers fail
  - [ ] Link fallback attempts via `request_group_id`

- [ ] **42. Provider-specific message conversion**
  - [ ] System prompt handling per provider (flag, field, or message role)
  - [ ] Vision support per provider (image_url, inline_data, etc.)
  - [ ] Tool/function calling conversion per provider
  - [ ] Multi-turn format differences (flatten vs native)

- [ ] **43. Unified token counting and cost calculation**
  - [ ] Normalize token counts from each provider's format
  - [ ] Provider-specific usage field extraction (Claude, OpenAI, Gemini, Ollama)
  - [ ] Unified `{ tokensIn, tokensOut, costUsd }` output

- [ ] **44. A/B testing across providers (optional)**
  - [ ] Split traffic between providers for same task category
  - [ ] Log both results, compare heuristic scores
  - [ ] Dashboard shows A/B test results
  - [ ] Auto-promote challenger if it outperforms baseline

- [ ] **Milestone: provider fallback works — disabling one provider routes to next cheapest**
- [ ] **Milestone: A/B test dashboard shows side-by-side provider comparison**
