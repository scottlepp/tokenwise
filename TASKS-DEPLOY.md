# Tasks — Docker Deployment + Hybrid Local Agent

## Phase A: Docker Deployment

- [ ] **1. Configure Next.js for standalone output**
  - [ ] Update `next.config.ts` with `output: "standalone"`

- [ ] **2. Create Dockerfile**
  - [ ] Multi-stage build: deps → build → runtime
  - [ ] Base image: `node:20-alpine`
  - [ ] Include drizzle-kit for schema push at startup
  - [ ] Copy standalone output + static + public assets

- [ ] **3. Create `.dockerignore`**
  - [ ] Exclude node_modules, .next, .git, .env.local, *.md

- [ ] **4. Create `docker-entrypoint.sh`**
  - [ ] Run `npx drizzle-kit push` for schema migrations
  - [ ] Start `node server.js`

- [ ] **5. Update `docker-compose.yml`**
  - [ ] Add healthcheck to postgres service
  - [ ] Add app service with build context
  - [ ] Wire `depends_on` with `service_healthy` condition
  - [ ] Pass through API key env vars from host

- [ ] **6. Create `.env.example`**
  - [ ] Document all environment variables with descriptions

- [ ] **Milestone: `docker compose up --build` starts proxy + DB, `curl /v1/models` works**

---

## Phase B: Agent Infrastructure (proxy-side)

- [ ] **7. Create agent protocol types**
  - [ ] Create `src/lib/agent/types.ts`
  - [ ] Define `AgentMessage`, `AgentRequest`, `AgentChunk`, `AgentComplete`, `AgentError` types
  - [ ] Define `ConnectedAgent` interface

- [ ] **8. Create agent connection manager**
  - [ ] Create `src/lib/agent/manager.ts`
  - [ ] `AgentManager` class with `globalThis` persistence (like `active-requests.ts`)
  - [ ] `registerAgent(agentId, controller)` — track connected agents
  - [ ] `removeAgent(agentId)` — cleanup on disconnect, reject pending requests
  - [ ] `hasConnectedAgent()` — availability check
  - [ ] `dispatchRequest(params)` — send request to agent, return Promise for non-streaming
  - [ ] `dispatchStreamRequest(params)` — send request, return `{ stream, metadata }` for streaming
  - [ ] `handleResponse(message)` — process chunk/complete/error POSTs from agent
  - [ ] Round-robin agent selection when multiple agents connected
  - [ ] 120s request timeout

- [ ] **9. Create SSE connect endpoint**
  - [ ] Create `src/app/api/agent/connect/route.ts`
  - [ ] `GET /api/agent/connect` — returns SSE stream
  - [ ] Validate `Authorization: Bearer <AGENT_SECRET>` header
  - [ ] Extract `X-Agent-Id` header
  - [ ] Register agent with manager
  - [ ] Send `connected` event on connect
  - [ ] Send `ping` events every 30s as keepalive
  - [ ] Cleanup on disconnect (remove agent from manager)

- [ ] **10. Create response POST endpoint**
  - [ ] Create `src/app/api/agent/response/route.ts`
  - [ ] `POST /api/agent/response` — receives chunk/complete/error messages
  - [ ] Validate auth header
  - [ ] Delegate to `agentManager.handleResponse()`
  - [ ] Return 200 on success, 401 on bad auth, 404 on unknown request

- [ ] **11. Create agent status endpoint**
  - [ ] Create `src/app/api/agent/status/route.ts`
  - [ ] `GET /api/agent/status` — list connected agents, pending requests count
  - [ ] Include agent IDs, connection duration, last activity

- [ ] **12. Create remote CLI provider**
  - [ ] Create `src/lib/providers/claude-cli-remote.ts`
  - [ ] Implement `LLMProvider` interface
  - [ ] `isAvailable()` — delegate to `agentManager.hasConnectedAgent()`
  - [ ] `getModels()` — same Claude models as `claude-cli` provider
  - [ ] `complete()` — delegate to `agentManager.dispatchRequest()`
  - [ ] `stream()` — delegate to `agentManager.dispatchStreamRequest()`

- [ ] **13. Register remote provider**
  - [ ] Update `src/lib/providers/index.ts`
  - [ ] Register `ClaudeCliRemoteProvider` when `AGENT_SECRET` env var is set
  - [ ] Load same models as `claude-cli` provider
  - [ ] Add `claude-cli-remote` to `BUILTIN_PROVIDER_TYPES` set

- [ ] **14. Add AGENT_SECRET to environment config**
  - [ ] Add to `.env.example`
  - [ ] Add to `docker-compose.yml` app service env vars

- [ ] **Milestone: `GET /api/agent/connect` returns SSE stream, `GET /api/agent/status` shows no agents**

---

## Phase C: Agent Package (separate repo — codewise-agent)

- [ ] **15. Create agent repo**
  - [ ] Initialize `codewise-agent` repo
  - [ ] `package.json` with `bin: { "codewise-agent": "./dist/index.js" }`
  - [ ] TypeScript config

- [ ] **16. Implement CLI entry point**
  - [ ] Create `src/index.ts`
  - [ ] Parse args: `--url`, `--secret`, `--agent-id`
  - [ ] Validate required args
  - [ ] Start agent

- [ ] **17. Implement SSE client + request handler**
  - [ ] Create `src/agent.ts`
  - [ ] Connect to `GET <url>/api/agent/connect` with auth headers
  - [ ] Parse SSE events (`connected`, `request`, `ping`)
  - [ ] Dispatch requests to CLI executor
  - [ ] Auto-reconnect on disconnect (exponential backoff: 1s → 30s max)
  - [ ] Handle SIGINT/SIGTERM gracefully

- [ ] **18. Implement CLI executor**
  - [ ] Create `src/cli-executor.ts`
  - [ ] Convert `ProviderRequest` messages to CLI format
  - [ ] Build `claude -p` args (model, system prompt, output format, etc.)
  - [ ] Spawn subprocess
  - [ ] Transform NDJSON output to OpenAI SSE chunks
  - [ ] POST chunks to `<url>/api/agent/response`
  - [ ] POST completion metadata when stream ends
  - [ ] POST error on failure
  - [ ] Handle long prompts (>100KB via stdin)

- [ ] **19. Publish to npm**
  - [ ] Build TypeScript
  - [ ] Test `npx codewise-agent --url http://localhost:3000 --secret test`
  - [ ] Publish to npm registry

- [ ] **Milestone: Agent connects, proxy routes `model: "sonnet"` through agent → CLI → response**
- [ ] **Milestone: Stopping agent → proxy falls back to `claude-api` (if configured)**
