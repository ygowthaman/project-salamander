# Shopping Agent — Phase 1 Build Plan

## Goal

A simple chat web application where users describe what they want to buy and Claude returns shopping suggestions. This is Phase 1 of a larger autonomous shopping agent. The focus is establishing the core foundation: LLM connectivity, real-time streaming, and session persistence.

No auth, no external search APIs, no browser automation, no payments in Phase 1.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js 20 + TypeScript + Fastify |
| LLM | Claude API via Anthropic TypeScript SDK (`claude-sonnet-4-6`) |
| Real-time | WebSockets (`@fastify/websocket`) |
| Database | PostgreSQL + Drizzle ORM + `pg` |
| Migrations | `drizzle-kit`, applied on server startup |
| Validation | zod |
| Local Dev DB | Local PostgreSQL 16 (Docker Compose optional) |
| Deployment | Google Cloud Platform |

The backend was originally Python/FastAPI/SQLAlchemy and was rewritten to
Node/TypeScript as a like-for-like port — same REST shapes, same WebSocket
protocol, same DB schema. The rationale and the full contract inventory live in
`PRD.md` at the repo root.

---

## Architecture

```
Browser (React)
  │
  │  HTTPS + WSS
  ▼
Cloud Run — Frontend (Nginx serving React static build)
  │
  │  API calls + WebSocket
  ▼
Cloud Run — Backend (Node + Fastify)
  ├── WebSocket handler (/ws/{session_id})
  ├── REST: POST /sessions
  ├── REST: GET /sessions/{id}/history
  └── Claude SDK streaming
  │
  │  via Cloud SQL Auth Proxy (sidecar)
  ▼
Cloud SQL — PostgreSQL
  ├── sessions table
  └── messages table

Secret Manager
  ├── ANTHROPIC_API_KEY
  └── DATABASE_URL
```

---

## Data Model

```sql
sessions
  id          UUID PRIMARY KEY   -- app-generated (crypto.randomUUID)
  title       TEXT NOT NULL      -- truncated first user message
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()

messages
  id          UUID PRIMARY KEY   -- app-generated (crypto.randomUUID)
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
  role        TEXT NOT NULL      -- 'user' | 'assistant'
  content     TEXT NOT NULL
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()

-- index backing the history query (session_id filter + created_at ordering)
messages_session_id_created_at_idx ON messages (session_id, created_at)
```

UUIDs are generated in the application rather than by `gen_random_uuid()`, so no
`pgcrypto` extension is required and the ID is known before the insert returns.

Messages are stored in the shape Claude's API expects (role/content), so replaying history into context requires no transformation.

---

## Backend Flow (per message)

```
1. Client connects: WebSocket /ws/{session_id}
2. Client sends JSON: { "message": "I need a laptop under $800" }
3. Backend loads all prior messages for session from DB
4. Saves incoming user message to DB
5. Builds Claude messages array: [...history, new user message]
6. Calls client.messages.stream({ messages: [...], system: SYSTEM_PROMPT })
7. For each token chunk → socket.send({ type: "chunk", text })
8. On stream complete → saves assistant message to DB
9. Sends { "type": "done" } signal to client
```

Steps 3–4 and step 8 each run in their own short DB transaction; nothing is held
open for the lifetime of the socket. Prompt caching (`cache_control: ephemeral`)
is set on the system prompt block.

---

## System Prompt (src/agent/index.ts)

The Claude system prompt defines the shopping assistant persona. Isolated in `src/agent/index.ts` so it can be tuned independently. Start simple:

```
You are a helpful shopping assistant. When a user describes what they want to buy,
ask clarifying questions if needed, then provide specific product suggestions with
reasoning. Include estimated price ranges, key features to look for, and trade-offs
between options. Be concise and practical.
```

---

## Frontend Flow

```
1. On load → POST /sessions → receive session_id
2. Open WebSocket: ws(s)://backend-url/ws/{session_id}
3. User types message → send JSON over WS
4. Tokens arrive (type: "chunk") → append to active message bubble
5. { type: "done" } → finalize bubble, re-enable input
6. Session sidebar → placeholder for now, wired up in Phase 2
```

---

## Project Structure

```
project-salamander/
├── node-server/
│   ├── src/
│   │   ├── server.ts             # Fastify bootstrap, CORS, plugin/route registration
│   │   ├── agent/
│   │   │   ├── index.ts          # system prompt + streaming generator
│   │   │   └── AGENT_CONTEXT.md
│   │   ├── api/
│   │   │   ├── sessions.ts       # REST routes + zod schemas
│   │   │   ├── websocket.ts      # WS handler (/ws/:session_id)
│   │   │   └── API_CONTEXT.md
│   │   └── db/
│   │       ├── client.ts         # pg Pool + Drizzle instance
│   │       ├── schema.ts         # Drizzle table definitions
│   │       ├── migrate.ts        # startup migration runner
│   │       ├── repositories/
│   │       │   ├── sessions.ts
│   │       │   └── messages.ts
│   │       └── DB_CONTEXT.md
│   ├── drizzle/                  # generated SQL migrations + journal
│   ├── drizzle.config.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile                # node:20-slim, listens on $PORT (8080)
│   ├── .env.example
│   └── .env                      # local only — ANTHROPIC_API_KEY, DATABASE_URL
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── InputBar.tsx
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts   # connect, send, stream token handler
│   │   └── api/sessions.ts       # REST: createSession, getHistory
│   ├── Dockerfile                # Nginx serving dist/
│   └── ... vite.config, tailwind.config, tsconfig
│
├── py-server/                    # legacy Python backend — kept for reference
├── docs/PLAN.md                  # this file
├── README.md                     # how to run everything
├── docker-compose.yml            # optional local Postgres (native install also fine)
└── cloudbuild.yaml               # GCP CI/CD pipeline
```

---

## UI Layout

Desktop (responsive, mobile-ready via Tailwind breakpoints):

```
┌─────────────────────────────────────────────┐
│  Shopping Assistant                          │
├─────────────────────────────────────────────┤
│                                             │
│   [assistant bubble] Hi! What are you       │
│   looking to buy today?                     │
│                                             │
│              [user bubble] I need a laptop  │
│                            under $800       │
│                                             │
│   [assistant bubble, streaming...]          │
│                                             │
├─────────────────────────────────────────────┤
│  [ Type what you're looking for...  ] [Send]│
└─────────────────────────────────────────────┘
```

Mobile: same layout, full width. No structural changes needed — just Tailwind breakpoint classes.

---

## Google Cloud Deployment

### Services Used

| Service | Purpose |
|---|---|
| Cloud Run | Backend (Node/Fastify) and Frontend (Nginx/React) |
| Cloud SQL | Managed PostgreSQL (`db-f1-micro` to start) |
| Artifact Registry | Docker image storage |
| Secret Manager | ANTHROPIC_API_KEY, DATABASE_URL |
| Cloud Build | CI/CD — triggers on push to `main` |
| Cloud SQL Auth Proxy | Sidecar on Cloud Run, avoids need for VPC Connector |

### CI/CD Flow

```
git push main
  └── Cloud Build triggers (cloudbuild.yaml)
        ├── Build backend Docker image
        ├── Push to Artifact Registry
        ├── Deploy backend to Cloud Run
        ├── Build frontend Docker image
        ├── Push to Artifact Registry
        └── Deploy frontend to Cloud Run
```

Images are built by Cloud Build on Google's infrastructure — **a local Docker
install is not required to deploy.** `gcloud` is the only CLI needed. Installing
Docker locally is worth it only for the faster iteration loop when debugging a
Dockerfile (~20s locally vs. a 1–3 min Cloud Build round trip).

### Environment Variables (set in Cloud Run, sourced from Secret Manager)

```
ANTHROPIC_API_KEY    → from Secret Manager
DATABASE_URL         → from Secret Manager
ALLOWED_ORIGINS      → frontend Cloud Run URL (CORS)
PORT                 → set by Cloud Run automatically (the server reads it; container default 8080)
```

### Cloud Run configuration for WebSockets

Cloud Run supports WebSockets, but the defaults are wrong for a long-lived chat
socket. Both of the following must be set on the **backend** service or
connections will drop mid-conversation:

```bash
gcloud run deploy salamander-server \
  --session-affinity \        # route a session's requests to the same instance
  --timeout=3600 \            # max connection lifetime; default 300s (5 min)
  --min-instances=1           # avoids cold-start latency on the first token
```

- **`--timeout`** caps how long a single request — including a WebSocket
  connection — may stay open. At the 300s default, a user who reads for five
  minutes before replying gets disconnected. 3600s is the maximum; a socket
  still dies at the hour mark, so the client must handle reconnection (below).
- **`--session-affinity`** is best-effort, not a guarantee. A scale-down or
  instance replacement will still cut live sockets.

Because the server holds no per-connection state — session state lives in
Postgres and every message re-reads history — a dropped socket loses nothing
durable. It is purely a client-side reconnect problem.

### Known gap: no client-side reconnect

`frontend/src/hooks/useWebSocket.ts` opens the socket once per `sessionId` and
has no `onclose` handler. When the socket drops — Cloud Run timeout, scale-down,
laptop sleep, flaky network — the chat silently stops working and only a page
reload recovers it. There is no user-visible error.

This is a Phase 1 gap, not a deployment misconfiguration; the settings above
reduce how often it happens but cannot eliminate it. Fixing it means adding to
the hook:

1. An `onclose` handler that reconnects with exponential backoff (cap the delay,
   cap the attempt count).
2. A UI state for "reconnecting" so a dead socket is visible rather than silent.
3. Re-fetching `GET /sessions/{id}/history` after a successful reconnect, since
   an assistant turn may have completed and been persisted while disconnected.

Item 3 matters most: the server persists the assistant message before sending
`done`, so a client that drops mid-stream and reconnects without re-reading
history will be missing a turn that exists in the database.

### Cost Estimate (Phase 1)

| Service | Cost |
|---|---|
| Cloud Run (backend + frontend) | Free tier (2M req/mo) |
| Cloud SQL db-f1-micro | ~$7–10/mo |
| Artifact Registry | ~$0.10/GB, negligible |
| Secret Manager | Free tier |
| Cloud SQL Auth Proxy | Free (replaces VPC Connector) |
| **Total** | **~$7–10/mo** |

---

## Local Development

See `README.md` for the full walkthrough. Short version:

```bash
# Postgres 16 — installed natively (one-time setup in README).
# docker-compose.yml is kept as an equivalent alternative:
#   docker compose up -d

# Backend (http://localhost:8000)
cd node-server
npm install
npm run dev

# Frontend (http://localhost:5173)
cd frontend
npm install
npm run dev
```

Backend `node-server/.env` (never committed):
```
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/shopping
ALLOWED_ORIGINS=http://localhost:5173
PORT=8000
```

Note the plain `postgresql://` scheme — the `+asyncpg` suffix was SQLAlchemy-specific
and `pg` does not understand it.

Frontend `frontend/.env` (never committed):
```
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

---

## Build Order

1. **Backend** — schema, DB client, agent (Claude streaming), Fastify routes + WebSocket
2. **Frontend** — React chat UI, useWebSocket hook, API calls
3. **Dockerfiles** — backend (Node) and frontend (Nginx)
4. **docker-compose.yml** — local Postgres for dev
5. **GCP setup** — project, Cloud SQL, Artifact Registry, Secret Manager, service accounts
6. **cloudbuild.yaml** — CI/CD pipeline

---

## Future Phases (out of scope for Phase 1)

- **Phase 2**: Product search tools (SerpAPI / Brave Search), Claude tool use
- **Phase 3**: Auth (Firebase Auth or Supabase), multi-user sessions, session history sidebar
- **Phase 4**: Browser automation (Playwright), live price extraction
- **Phase 5**: Checkout execution with confirmation gates, price drop notifications
- **Phase 6**: Mobile PWA or React Native (same backend API)

---

## Key Design Decisions

- **WebSocket over HTTP polling**: real-time token streaming requires a persistent connection
- **Session affinity + raised request timeout on Cloud Run**: both required for WebSocket connections; see the Cloud Run configuration section above
- **Stateless server**: no per-connection state is held in memory — history is re-read from Postgres on every message. A dropped socket therefore costs nothing durable, which is what makes best-effort session affinity acceptable
- **Cloud SQL Auth Proxy sidecar**: avoids VPC Connector cost (~$6/mo saved), proxy runs as a sidecar container on Cloud Run
- **Prompt caching on system prompt**: cheap to add now, saves cost as conversations grow
- **Messages stored in role/content shape**: matches Claude API format exactly, no transformation needed when replaying history
- **UUID session IDs**: enables future auth hookup — just add user_id FK to sessions table
- **One language end-to-end**: backend and frontend are both TypeScript, so types, tooling, and mental model are shared. A future ML workload gets added as a separate Python service rather than pulling the whole backend back to Python
- **Explicit migrations over sync-on-startup**: `drizzle-kit` generates versioned SQL that is applied at boot, replacing SQLAlchemy's `create_all` (which was never migration-safe)
- **App-generated UUIDs**: no `pgcrypto` dependency, and the ID exists client-side before the insert round-trips
