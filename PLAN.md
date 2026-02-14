# Plan: Smart Claude Proxy — OpenAI-Compatible with Intelligent Routing & Analytics

## Context

You have a team Claude account and can authenticate via the `claude` CLI (OAuth tokens in `~/.claude/`), but don't have API keys. Cursor supports custom OpenAI-compatible endpoints. This proxy bridges the two: it accepts OpenAI-format HTTP requests from Cursor, intelligently picks the cheapest Claude model that can handle the task, forwards via `claude -p`, logs everything to PostgreSQL, and provides an analytics dashboard to track credit usage and success rates.

**No API key needed** — auth is handled entirely by the CLI's existing OAuth session.

## Architecture

```
                                    ┌─────────────────────────────────────────┐
                                    │         Next.js App (localhost:3000)     │
                                    │                                         │
Cursor ──POST /v1/chat/completions──►  1. Classify task complexity            │
                                    │  2. Smart Router picks model             │
                                    │     (haiku / sonnet / opus)              │
                                    │  3. Spawn: claude -p --model <picked>   │
                                    │  4. Stream/collect response              │
                                    │  5. Log to PostgreSQL                    │
                                    │  6. Return OpenAI-format response        │
Cursor ◄── SSE or JSON response ────┤                                         │
                                    │                                         │
Browser ── GET /dashboard ──────────►  Analytics UI (shadcn + Recharts)       │
                                    └────────────────┬────────────────────────┘
                                                     │
                                              ┌──────▼──────┐
                                              │  PostgreSQL  │
                                              │   (Docker)   │
                                              └─────────────┘
```

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router) | API routes + dashboard UI in one app |
| Database | PostgreSQL (Docker) | Proven, great aggregation queries, Drizzle ORM support |
| ORM | Drizzle | Lightweight, SQL-like, edge-compatible, great TS types |
| Dashboard UI | shadcn/ui + Tailwind | Polished components, copy-paste, no runtime deps |
| Charts | Recharts | Lightweight (~60KB), declarative, good defaults |
| Data fetching | TanStack Query | Caching, auto-refresh for live dashboard |

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
│   │   │       ├── cost-over-time.tsx          # Line chart
│   │   │       ├── model-breakdown.tsx         # Pie chart
│   │   │       ├── success-rates.tsx           # Bar charts
│   │   │       ├── request-volume.tsx          # Bar chart
│   │   │       ├── latency-chart.tsx           # Bar chart
│   │   │       ├── stats-cards.tsx             # KPI summary cards
│   │   │       ├── recent-requests.tsx         # Table with filtering
│   │   │       └── cost-savings.tsx            # Savings estimate card
│   │   ├── api/
│   │   │   ├── feedback/route.ts               # POST — user rates a response
│   │   │   └── stats/route.ts                  # GET — dashboard data queries
│   │   └── v1/
│   │       ├── chat/completions/route.ts       # POST — main proxy endpoint
│   │       └── models/route.ts                 # GET — model list
│   ├── lib/
│   │   ├── config.ts                           # Model mapping, cost tiers, constants
│   │   ├── types.ts                            # OpenAI + internal types
│   │   ├── message-converter.ts                # OpenAI messages[] → prompt + system prompt
│   │   ├── claude-cli.ts                       # Spawn/manage claude child processes
│   │   ├── stream-transformer.ts               # Claude NDJSON → OpenAI SSE
│   │   ├── router.ts                           # Smart model selection logic
│   │   ├── task-classifier.ts                  # Prompt → task category + complexity score
│   │   ├── success-evaluator.ts                # Determine if response succeeded
│   │   └── db/
│   │       ├── index.ts                        # Drizzle client
│   │       ├── schema.ts                       # Table definitions
│   │       └── queries.ts                      # Dashboard query helpers
│   └── components/ui/                          # shadcn/ui components
└── drizzle/                                    # Generated migrations
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

  -- Model selection
  model_requested VARCHAR(100),            -- What Cursor asked for
  model_selected  VARCHAR(100) NOT NULL,   -- What the router picked
  router_reason   VARCHAR(200),            -- Why this model was chosen

  -- Response metrics
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  streaming       BOOLEAN NOT NULL DEFAULT false,

  -- Success tracking (three layers)
  cli_success     BOOLEAN NOT NULL DEFAULT true,    -- CLI exit code 0?
  heuristic_score INTEGER,                          -- 0-100 from response heuristics
  user_rating     INTEGER,                          -- 1-5 from optional feedback
  error_message   VARCHAR(500)
);

CREATE INDEX idx_task_logs_created_at ON task_logs (created_at DESC);
CREATE INDEX idx_task_logs_model ON task_logs (model_selected);
CREATE INDEX idx_task_logs_category ON task_logs (task_category);
```

## Implementation Steps

### Phase 1: Core Proxy (Steps 1–9)

#### 1. Bootstrap project
- `npx create-next-app@latest . --typescript --app --src-dir --tailwind --eslint --use-npm`
- Add shadcn/ui: `npx shadcn@latest init`
- Install deps: `npm install drizzle-orm postgres recharts @tanstack/react-query`
- Dev deps: `npm install -D drizzle-kit`

#### 2. Docker + Database setup
- `docker-compose.yml` with PostgreSQL 17
- `drizzle.config.ts` pointing to local PG
- `src/lib/db/schema.ts` — Drizzle schema matching SQL above
- `src/lib/db/index.ts` — Drizzle client (uses `DATABASE_URL` env var)
- Run `npx drizzle-kit push` to create tables

#### 3. Create `src/lib/types.ts`
- OpenAI request/response types: `ChatCompletionRequest`, `ChatCompletionResponse`, `ChatCompletionChunk`
- Internal types: `TaskCategory`, `RouterDecision`, `TaskLog`

#### 4. Create `src/lib/config.ts`
- Model map: `gpt-4`/`gpt-4o` → `opus`, `gpt-4o-mini` → `sonnet`, `gpt-3.5-turbo` → `haiku`
- Pass-through Claude names (`opus`, `sonnet`, `haiku`)
- Cost per model (input/output per 1M tokens) for cost calculation
- Default model: `sonnet`

#### 5. Create `src/lib/message-converter.ts`
- Extract `role: "system"` → `--system-prompt` string
- Single user message → pass directly
- Multi-turn → flatten with `[User]`/`[Assistant]` labels
- Handle `content` as string or `ContentPart[]`

#### 6. Create `src/lib/claude-cli.ts`
- Build CLI args: `-p`, `--output-format json|stream-json`, `--model`, `--system-prompt`, `--verbose`, `--no-session-persistence`
- Disable tools for pure text completion
- Non-streaming: spawn, collect stdout, parse JSON
- Streaming: spawn and return `ChildProcess`
- Long prompts (>100KB): pipe via stdin
- Error handling: `ENOENT`, non-zero exit, `is_error`

#### 7. Create `src/lib/stream-transformer.ts`
- `TransformStream`: Claude NDJSON → OpenAI SSE
- Buffer partial lines, parse `message_start`, `content_block_delta`, `message_delta`
- Flush `data: [DONE]\n\n`
- Also accumulate full response text + token counts for logging

#### 8. Create `src/app/v1/chat/completions/route.ts`
- Parse body, validate `messages`
- Classify task → pick model (or use requested model if `model` field is a known Claude name)
- Spawn CLI, stream or collect response
- Log result to PostgreSQL
- Return OpenAI-format response

#### 9. Create `src/app/v1/models/route.ts`
- Return available models in OpenAI format

### Phase 2: Smart Routing (Steps 10–13)

#### 10. Create `src/lib/task-classifier.ts`
Classifies incoming prompts into categories and complexity scores.

**Task categories** (detected via keyword matching + heuristics):
| Category | Signals |
|----------|---------|
| `simple_qa` | Short prompt, question words, no code |
| `code_gen` | "write", "create", "implement", "build" + code context |
| `code_review` | "review", "check", code blocks in input |
| `debug` | "debug", "fix", "error", "bug", stack traces |
| `refactor` | "refactor", "clean up", "restructure" |
| `explain` | "explain", "what does", "how does", "why" |
| `other` | Anything else |

**Complexity score** (0–100):
```
score = base(10)
  + min(token_count / 100, 30)          # longer = more complex
  + code_block_count * 5                 # code blocks add complexity
  + complex_keywords * 10                # "debug", "architect", etc.
  - simple_keywords * 5                  # "what is", "explain", etc.
  + conversation_turns * 3               # multi-turn is harder
  + (system_prompt_length > 200 ? 5 : 0) # long system prompts
```

#### 11. Create `src/lib/router.ts`
Smart model selection combining heuristics + historical performance.

**Decision flow:**
1. If user explicitly requested a Claude model name → use it (respect user intent)
2. Classify task → get category + complexity score
3. Look up historical success rate for this category per model (from DB)
4. Pick cheapest model whose success rate for this category exceeds threshold (default 80%)
5. If no history yet → use complexity score tiers:
   - Score 0–25 → haiku
   - Score 26–60 → sonnet
   - Score 61–100 → opus
6. **Consecutive failure detection**: if a model has failed 3+ times in a row for this category, skip it

**Router logs its reasoning** in `router_reason` field for debugging.

#### 12. Create `src/lib/success-evaluator.ts`
Three-layer success evaluation:

**Layer 1 — CLI exit code** (`cli_success`):
- `true` if exit code 0 and no `is_error` in JSON
- `false` otherwise

**Layer 2 — Response heuristics** (`heuristic_score`, 0–100):
- Starts at 70 (neutral)
- −30 if response is empty
- −20 if response < 20 chars for a non-trivial prompt
- +15 if response contains code block when task was code-related
- +10 if response length is proportional to prompt complexity
- −15 if response contains "I can't", "I'm unable", "I don't have"
- Cap at 0–100

**Layer 3 — User feedback** (`user_rating`, 1–5):
- Set via `/feedback` command in Cursor chat (see step 13) or `POST /api/feedback`
- Dashboard shows tasks with no rating as "unrated"

**Combined success** (for routing decisions):
- `cli_success = false` → always failure
- `heuristic_score < 40` → likely failure
- `user_rating <= 2` → confirmed failure
- Everything else → success

#### 13. In-chat `/feedback` command
The proxy intercepts special messages before they reach Claude. Users type these directly in Cursor's chat:

**Syntax:**
```
/feedback good                    → rates the most recent task as 5/5
/feedback bad                     → rates the most recent task as 1/5
/feedback good <taskId>           → rates a specific task as 5/5
/feedback bad <taskId>            → rates a specific task as 1/5
/feedback <1-5>                   → rates the most recent task with a numeric score
/feedback <1-5> <taskId>          → rates a specific task with a numeric score
```

**Implementation in `src/app/v1/chat/completions/route.ts`:**
- Before normal processing, check if the last user message starts with `/feedback`
- Parse the command, look up the task in DB (most recent, or by ID)
- Update `user_rating` on the task log row
- Return a synthetic OpenAI response confirming the rating (not forwarded to Claude)
- Response includes the task summary so the user knows which task was rated

**The proxy also returns a `x-task-id` header** on every completion response, so users can reference specific tasks if needed.

#### 14. Wire routing into completions endpoint
- Before spawning CLI: call `router.selectModel(messages, taskCategory, complexityScore)`
- After response: call `successEvaluator.evaluate(response, taskCategory)` and log to DB

### Phase 3: Dashboard (Steps 15–19)

#### 15. Create `src/lib/db/queries.ts`
Dashboard query helpers using Drizzle:
- `getCostOverTime(days)` — daily cost aggregated
- `getModelBreakdown(days)` — cost and count per model
- `getSuccessRates(days)` — success rate by model and by category
- `getRequestVolume(days)` — requests per day
- `getLatencyByModel(days)` — avg latency per model
- `getRecentRequests(limit, offset)` — paginated task log
- `getCostSavings(days)` — actual cost vs hypothetical all-opus cost
- `getSummaryStats(days)` — total requests, total cost, avg latency, overall success rate

#### 16. Create `src/app/api/stats/route.ts`
- `GET /api/stats?days=7&metric=cost_over_time` — parameterized dashboard queries
- Returns JSON for each chart widget

#### 17. Create `src/app/api/feedback/route.ts`
- `POST /api/feedback` with `{ taskId: string, rating: 1-5 }`
- Updates `user_rating` column for the given task log
- Shared logic with the `/feedback` chat command (both call same DB update)

#### 18. Create dashboard page `src/app/dashboard/page.tsx`
Layout with these widgets:
- **Stats cards row**: Total requests, total cost, avg latency, overall success rate
- **Cost over time**: Line chart (daily cost, colored by model)
- **Model breakdown**: Donut chart (% of requests + cost per model)
- **Success rate by model**: Horizontal bar chart
- **Success rate by category**: Horizontal bar chart
- **Request volume**: Bar chart (daily request count)
- **Latency by model**: Bar chart
- **Cost savings**: Card showing actual vs opus-only cost
- **Recent requests**: Sortable table (time, category, model, tokens, cost, success, rating)

#### 19. Feedback UI in recent requests table
- Each row in recent requests table has thumbs up/down or 1–5 star rating
- Clicking sends `POST /api/feedback`

### Phase 4: Docker & Polish (Steps 20–21)

#### 20. Docker setup
`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:17
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: claude_proxy
      POSTGRES_USER: claude
      POSTGRES_PASSWORD: claude
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Optional: add the Next.js app itself as a service for fully dockerized deployment.

#### 21. Clean up & polish
- Remove create-next-app boilerplate
- Add `.env.local` template with `DATABASE_URL`
- Add README with setup instructions
- Auto-redirect `/` to `/dashboard`

## Key Design Decisions

- **CLI auth, not API keys**: Delegates all auth to `claude -p`'s OAuth session
- **Smart routing by default**: If Cursor sends `gpt-4` or any non-Claude model name, the router classifies and picks the cheapest viable model. If Cursor sends `opus`/`sonnet`/`haiku`, it respects the explicit choice.
- **Three-layer success tracking**: CLI exit code (automatic) + response heuristics (automatic) + user feedback (optional). Routing learns from all three.
- **Consecutive failure detection**: If haiku fails 3x in a row on `code_gen` tasks, the router auto-promotes to sonnet for that category
- **Stateless proxy**: Each request spawns a fresh `claude -p`. Multi-turn context is flattened into the prompt.
- **PostgreSQL over TimescaleDB**: Simpler setup, plenty fast for this scale, can add TimescaleDB extension later if needed
- **Dashboard is in-app**: No separate service — same Next.js app serves both the proxy API and the analytics UI

## Cursor Configuration

```
Settings > Models > OpenAI API:
  Base URL:  http://localhost:3000/v1
  API Key:   sk-local          (any non-empty string)
  Model:     auto               (or opus, sonnet, haiku for explicit choice)
```

When model is `auto` (or any OpenAI model name like `gpt-4`), the smart router takes over.

## Verification

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Push schema
npx drizzle-kit push

# 3. Start the proxy
npm run dev

# 4. Test models endpoint
curl http://localhost:3000/v1/models

# 5. Test non-streaming (smart routing)
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"What is 2+2?"}]}'

# 6. Test streaming
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Write a React component"}],"stream":true}'

# 7. Check the dashboard
open http://localhost:3000/dashboard

# 8. Rate a response
curl -X POST http://localhost:3000/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<uuid-from-response>","rating":5}'

# 9. Configure Cursor and test in-editor
```
