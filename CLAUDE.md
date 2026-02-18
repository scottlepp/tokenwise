# Claude Proxy — Smart LLM Proxy

OpenAI-compatible local proxy that routes requests from agentic coding tools (Cline, Aider, Cursor, Continue, etc.) to multiple LLM providers with smart model selection, cross-provider cost optimization, and analytics.

## Project docs

- @PLAN.md — full architecture, pipeline, and implementation details
- @TASKS.md — checklist of all implementation steps; **mark tasks complete as you finish them**

## Task tracking

IMPORTANT: After completing any implementation step, immediately update TASKS.md by changing `- [ ]` to `- [x]` for each finished subtask and its parent task. Do not batch — mark done as you go.

## Commands

```bash
# Dev
npm run dev                    # Start Next.js on port 3000
docker compose up -d           # Start PostgreSQL
npx drizzle-kit push           # Push schema to DB
npx drizzle-kit generate       # Generate migration files

# Test proxy
curl http://localhost:3000/v1/models
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}],"stream":true}'
```

## Tech stack

- Next.js 15, App Router, TypeScript (strict)
- Drizzle ORM + PostgreSQL 17 (Docker)
- shadcn/ui + Tailwind + Recharts for dashboard
- Multi-provider support: Claude CLI, Claude API, OpenAI, Gemini, Ollama, custom OpenAI-compatible

## Supported providers

| Provider      | Auth                       | Transport               |
| ------------- | -------------------------- | ----------------------- |
| Claude (CLI)  | OAuth session (~/.claude/) | `claude -p` subprocess  |
| Claude (API)  | `ANTHROPIC_API_KEY`        | HTTPS API               |
| OpenAI        | `OPENAI_API_KEY`           | HTTPS API               |
| Google Gemini | `GEMINI_API_KEY`           | HTTPS API               |
| Ollama        | None (local)               | HTTP (localhost:11434)  |
| Custom        | Configurable               | OpenAI-compatible HTTPS |

Providers are **opt-in** — only providers with configured credentials are active.

## Code style

- Use `import type` for type-only imports
- Prefer named exports over default exports
- Use `crypto.randomUUID()` for IDs (no uuid package)
- Error responses must match OpenAI error format: `{ error: { message, type, code } }`
- All DB access goes through `src/lib/db/queries.ts` — no raw SQL in route handlers
- Provider implementations go in `src/lib/providers/` and implement the `LLMProvider` interface
- Stream transformers go in `src/lib/stream-transformers/` (one per provider format)

## Architecture rules

- **Request pipeline order**: parse → /feedback intercept → cache → compress → classify → route (cross-provider) → budget check → dispatch to provider → log → respond
- **Provider abstraction**: All providers implement `LLMProvider` interface. Adding a new provider = one file + register in init.
- **Cross-provider routing**: Router compares costs across ALL enabled providers. Complexity score determines tier (economy/standard/premium), then cheapest model in tier wins.
- **Model resolution**: Supports exact model names (`gpt-4o`), aliases (`sonnet`), tier names (`economy`), provider prefix (`openai:gpt-4o`), and `auto` (full smart routing).
- **Compression is lossless only** — normalize structure, never rewrite intent. Preserve XML-like tags (`<context>`, `<file>`, tool definitions, etc.) from clients. If a stage fails, skip it silently.
- **Every response** includes `x-task-id`, `x-provider`, `x-model` headers.
- **Streaming** uses provider-specific stream transformers to normalize to OpenAI SSE format.
- **Graceful degradation**: If a provider goes down, others automatically take over via fallback chains.

## Environment

```bash
# Database (required)
DATABASE_URL=postgresql://claude:claude@localhost:5432/claude_proxy

# Claude CLI (auto-detected — no config needed if `claude` is on PATH)

# Claude API (optional)
ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (optional)
OPENAI_API_KEY=sk-...

# Google Gemini (optional)
GEMINI_API_KEY=AIza...

# Ollama (optional — auto-detected on localhost:11434)
OLLAMA_BASE_URL=http://localhost:11434

# Custom OpenAI-compatible providers (optional JSON array)
CUSTOM_PROVIDERS='[{"id":"groq","displayName":"Groq","baseUrl":"https://api.groq.com/openai/v1","apiKey":"gsk_...","models":[...]}]'

# Router defaults
DEFAULT_PROVIDER=claude-cli
SUCCESS_THRESHOLD=0.8
CONSECUTIVE_FAILURE_LIMIT=3
```

## Gotchas

- `claude -p` requires `--verbose` flag when using `--output-format stream-json`
- Long prompts (>100KB) must be piped via stdin, not passed as CLI argument (ARG_MAX limit)
- Clients (Cursor, Cline, etc.) require a non-empty API key field — the proxy ignores the Authorization header entirely
- `--no-session-persistence` is needed to avoid writing session files per request
- Different providers report tokens differently — each adapter normalizes to `{ tokensIn, tokensOut, costUsd }`
- Ollama models are $0 cost, making them default for simple tasks when available
