# Plan: Docker Deployment + Hybrid Local Agent Architecture

## Context

CodeWise currently runs only in local dev mode (`npm run dev` + Docker PostgreSQL). This phase adds:

1. **Full Docker deployment** — `docker compose up` runs everything (app + DB), deployable to AWS or any VM
2. **Hybrid local agent** — when deployed remotely, the Claude CLI provider can't run on the server (needs `claude` binary + OAuth tokens). A lightweight agent on a developer's machine connects to the proxy via SSE and executes CLI requests on the proxy's behalf.

---

## Part 1: Docker Deployment

### 1.1 Update `next.config.ts`

Add `output: "standalone"` for optimized Docker builds. This produces a self-contained output in `.next/standalone` that includes only necessary dependencies.

### 1.2 Create `Dockerfile` (multi-stage)

- **Stage 1 (deps)**: `node:20-alpine`, install production dependencies
- **Stage 2 (build)**: Copy source, run `npm run build`
- **Stage 3 (runtime)**: Copy standalone output + static/public assets, run `node server.js`
- Include `drizzle-kit` + `drizzle-orm` + `postgres` in runtime for schema push at startup

### 1.3 Create `.dockerignore`

Exclude: `node_modules`, `.next`, `.git`, `.env.local`, `*.md`, `agent/`

### 1.4 Create `docker-entrypoint.sh`

Shell script that:
1. Runs `npx drizzle-kit push` to apply schema migrations
2. Starts `node server.js`

### 1.5 Update `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:17
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U claude"]
      interval: 5s
      timeout: 3s
      retries: 5
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: claude_proxy
      POSTGRES_USER: claude
      POSTGRES_PASSWORD: claude
    volumes:
      - pgdata:/var/lib/postgresql/data

  app:
    build: .
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://claude:claude@postgres:5432/claude_proxy
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
      AGENT_SECRET: ${AGENT_SECRET:-}

volumes:
  pgdata:
```

### 1.6 Create `.env.example`

Template documenting all available environment variables.

### Files to create/modify:

| File | Action |
|------|--------|
| `next.config.ts` | Modify — add `output: "standalone"` |
| `docker-compose.yml` | Modify — add healthcheck, app service |
| `Dockerfile` | Create — multi-stage build |
| `.dockerignore` | Create |
| `.env.example` | Create |
| `docker-entrypoint.sh` | Create — migrations + server start |

---

## Part 2: Hybrid Local Agent (SSE-based)

### Architecture

```
┌────────────────────────────────┐         ┌──────────────────────────────┐
│   CodeWise Proxy (AWS)         │         │  Local Agent (dev machine)   │
│                                │  SSE    │                              │
│  GET /api/agent/connect  ──────│────────►│  Receives request events     │
│                                │         │                              │
│  POST /api/agent/response ◄────│─────────│  POSTs chunks + completion   │
│                                │  HTTP   │                              │
│  ┌──────────────────────┐     │         │  Has `claude` binary         │
│  │ ClaudeCliRemote       │     │         │  Has ~/.claude/ OAuth        │
│  │ Provider              │     │         │  Spawns claude -p            │
│  └──────────────────────┘     │         │                              │
└────────────────────────────────┘         └──────────────────────────────┘
```

### Why SSE over WebSocket

- No `ws` dependency — Next.js API routes support SSE natively (already used for `/api/activity/stream`)
- Standard HTTP — works through any proxy/load balancer without special config
- Agent POSTs results back — simple HTTP, no bidirectional socket needed
- Codebase already has SSE patterns to follow

### 2.1 Protocol (HTTP/SSE)

**Agent connects (SSE):**
```
GET /api/agent/connect
Headers:
  Authorization: Bearer <AGENT_SECRET>
  X-Agent-Id: <agent-identifier>

Response: SSE stream
  event: connected
  data: { "agentId": "...", "status": "ok" }

  event: request
  data: { "id": "req-123", "params": { model, messages, stream, ... } }

  event: ping
  data: {}
```

**Agent responds (HTTP POST):**
```
POST /api/agent/response
Headers:
  Authorization: Bearer <AGENT_SECRET>
  X-Agent-Id: <agent-id>
Content-Type: application/json

# Streaming chunks:
{ "type": "chunk", "requestId": "req-123", "data": "data: {\"id\":\"...\"}\n\n" }

# Completion:
{ "type": "complete", "requestId": "req-123", "metadata": { text, tokensIn, tokensOut, costUsd, finishReason } }

# Errors:
{ "type": "error", "requestId": "req-123", "error": "..." }
```

### 2.2 Agent Manager (`src/lib/agent/manager.ts`)

In-memory singleton using `globalThis` pattern (same as `active-requests.ts`):

```typescript
class AgentManager {
  agents: Map<string, { controller: ReadableStreamController, lastSeen: number }>
  pendingRequests: Map<string, { resolve, reject, streamController? }>

  registerAgent(agentId, controller)     // Called when agent connects via SSE
  removeAgent(agentId)                   // Called when SSE connection closes
  hasConnectedAgent(): boolean           // At least one agent online
  dispatchRequest(params): Promise       // Send request event to an agent
  dispatchStreamRequest(params): { stream, metadata }
  handleResponse(agentId, message)       // Process chunk/complete/error from agent
}
```

When a `claude-cli-remote` request arrives, the manager picks an available agent, writes a `request` SSE event to that agent's stream controller, and creates a pending promise. When the agent POSTs back chunks/completion, the manager resolves the promise or feeds the stream.

### 2.3 Remote Provider (`src/lib/providers/claude-cli-remote.ts`)

```typescript
class ClaudeCliRemoteProvider extends BaseProvider {
  readonly id = "claude-cli-remote";
  readonly displayName = "Claude (Remote Agent)";

  isAvailable(): boolean {
    return agentManager.hasConnectedAgent();
  }

  getModels(): ProviderModel[] {
    return this.models; // Same Claude models as claude-cli
  }

  async complete(params): Promise<ProviderResponse> {
    return agentManager.dispatchRequest(params);
  }

  async stream(params): Promise<ProviderStreamResponse> {
    return agentManager.dispatchStreamRequest(params);
  }
}
```

### 2.4 Provider Registration

Update `src/lib/providers/index.ts` — register remote provider when `AGENT_SECRET` is set:

```typescript
if (process.env.AGENT_SECRET) {
  const models = await loadModelsForProvider("claude-cli");
  const { ClaudeCliRemoteProvider } = await import("./claude-cli-remote");
  providerRegistry.register(new ClaudeCliRemoteProvider(models));
}
```

The router already handles cross-provider selection:
- On server with no `claude` binary: `claude-cli` unavailable, `claude-cli-remote` available when agent connected
- Falls back to `claude-api` if no agent and API key is set
- Same models/costs — router treats it identically to local CLI

### 2.5 Agent (separate repo)

The agent is a **separate GitHub repo** (`codewise-agent`) distributable via npm:

```bash
npx codewise-agent --url https://your-proxy.com --secret your-secret
```

#### Structure:
```
codewise-agent/
├── package.json          # bin: { "codewise-agent": "./dist/index.js" }
├── tsconfig.json
├── src/
│   ├── index.ts          # CLI entry point, arg parsing
│   ├── agent.ts          # SSE connect, request handling, response posting
│   └── cli-executor.ts   # Spawns claude -p, transforms output, posts chunks
```

#### Behavior:
1. Parse args: `--url`, `--secret`, `--agent-id` (defaults to hostname)
2. Connect to `GET <url>/api/agent/connect` with auth header
3. Listen for SSE `request` events
4. For each request:
   - Build CLI args (same logic as `ClaudeCliProvider`)
   - Spawn `claude -p --output-format stream-json ...`
   - Transform NDJSON output
   - POST each chunk to `<url>/api/agent/response`
   - POST completion metadata when stream ends
5. Auto-reconnect on disconnect (exponential backoff: 1s → 2s → 4s → ... max 30s)
6. Handle SIGINT/SIGTERM gracefully

The agent duplicates CLI spawn logic from `claude-cli.ts` — intentional since it's a separate package with no proxy dependency.

### 2.6 Edge Cases

| Scenario | Handling |
|----------|----------|
| Agent disconnects mid-stream | SSE close detected, reject pending request, client gets 502, router can retry with fallback |
| Multiple agents | Round-robin dispatch across connected agents |
| No agent connected | `isAvailable()` returns false, router skips to `claude-api` or other providers |
| Agent reconnects | Re-registers, immediately available for new requests |
| Request timeout | 120s timeout, reject if agent doesn't respond |
| Proxy restarts | Agent reconnects automatically (built into agent script) |
| Agent secret mismatch | 401 on connect and response endpoints |

### Files to create/modify:

| File | Action |
|------|--------|
| `src/lib/agent/types.ts` | Create — protocol message types |
| `src/lib/agent/manager.ts` | Create — agent connection manager |
| `src/app/api/agent/connect/route.ts` | Create — SSE endpoint for agents |
| `src/app/api/agent/response/route.ts` | Create — chunk/complete POST endpoint |
| `src/app/api/agent/status/route.ts` | Create — dashboard status endpoint |
| `src/lib/providers/claude-cli-remote.ts` | Create — remote provider |
| `src/lib/providers/index.ts` | Modify — register remote provider |

---

## Verification

```bash
# Docker deployment
docker compose up --build
curl http://localhost:3000/v1/models

# Agent (on dev machine)
npx codewise-agent --url http://your-server:3000 --secret mysecret

# Test remote routing
curl http://your-server:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"sonnet","messages":[{"role":"user","content":"Hello"}],"stream":true}'

# Test fallback (stop agent → falls back to claude-api if configured)

# Agent status
curl http://your-server:3000/api/agent/status
```
