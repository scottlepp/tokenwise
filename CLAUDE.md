# Claude Wrapper — Smart Claude Proxy

OpenAI-compatible local proxy that routes Cursor requests to Claude CLI with smart model selection, cost optimization, and analytics.

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
- `claude -p` CLI for all model calls (no API key — uses OAuth from ~/.claude/)

## Code style

- Use `import type` for type-only imports
- Prefer named exports over default exports
- Use `crypto.randomUUID()` for IDs (no uuid package)
- Error responses must match OpenAI error format: `{ error: { message, type, code } }`
- All DB access goes through `src/lib/db/queries.ts` — no raw SQL in route handlers

## Architecture rules

- **Request pipeline order**: parse → /feedback intercept → cache → compress → classify → route → budget check → spawn CLI → log → respond
- **Compression is lossless only** — normalize structure, never rewrite intent. Preserve Cursor's XML-like tags (`<context>`, `<file>`). If a stage fails, skip it silently.
- **Smart router**: picks cheapest model that historically succeeds for the task category. Respects explicit Claude model names from user. Falls back to complexity-score tiers when no history.
- **Every response** includes `x-task-id` header for feedback targeting.
- **Streaming** uses `TransformStream` piping Claude NDJSON → OpenAI SSE. Non-streaming collects full stdout JSON.

## Environment

```
DATABASE_URL=postgresql://claude:claude@localhost:5432/claude_proxy
```

## Gotchas

- `claude -p` requires `--verbose` flag when using `--output-format stream-json`
- Long prompts (>100KB) must be piped via stdin, not passed as CLI argument (ARG_MAX limit)
- Cursor requires a non-empty API key field — the proxy ignores the Authorization header entirely
- `--no-session-persistence` is needed to avoid writing session files per request
