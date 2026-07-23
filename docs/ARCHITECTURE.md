# Salamander — Architecture

Salamander is a shopping agent. Today it is a chat web app: a user describes what
they want to buy and Claude streams back suggestions in real time. This document
is the source of truth for how the system is built — its layers, data model,
runtime flows, deployment shape, and the decisions behind them.

- **What exists today (Phase 1):** LLM connectivity, WebSocket token streaming,
  and session persistence. No auth, no external search APIs, no payments.
- **Where it's going:** an inventory-aware shopping agent with accounts, mandates,
  budgets, a reorder scheduler, and assisted cart-building. That roadmap is
  specified in [`PRD.md`](PRD.md); the [Roadmap](#roadmap) section here
  summarizes it. Everything else in this document describes the shipped system.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| Backend | Node.js 20 + TypeScript + Fastify |
| LLM | Claude API via the Anthropic TypeScript SDK (`claude-sonnet-4-6`) |
| Real-time | WebSockets (`@fastify/websocket`) |
| Database | PostgreSQL 16 + Drizzle ORM over `pg` (node-postgres) |
| Migrations | `drizzle-kit` — versioned SQL applied on server startup |
| Validation | zod |
| Local dev DB | Local PostgreSQL 16 |
| Deployment | Google Cloud Platform — Cloud Run + Cloud SQL, deployed from source with Cloud Buildpacks |

One language end to end: backend and frontend are both TypeScript, so types,
tooling, and mental model are shared. A future ML workload would be added as a
separate service rather than pulling the backend into another language.

---

## Runtime topology

```
Browser (React SPA)
  │
  │  HTTPS (REST)  +  WSS (WebSocket)
  ▼
Frontend — static React build (Vite) served by a web server / CDN
  │
  │  POST /sessions, GET /sessions/{id}/history   (REST)
  │  /ws/{session_id}                             (WebSocket, one long-lived conn)
  ▼
Backend — Node + Fastify
  ├── REST routes ......... src/api/sessions.ts
  ├── WebSocket handler ... src/api/websocket.ts
  ├── Agent (Claude) ...... src/agent/index.ts   ──► Anthropic API (streaming)
  └── DB access ........... src/db/*
  │
  ▼
PostgreSQL
  ├── sessions
  └── messages
```

The backend holds **no per-connection state in memory**. All durable state lives
in Postgres, and every chat turn re-reads history from the database. A dropped
socket therefore loses nothing durable — this is what makes horizontal scaling
and best-effort session affinity acceptable.

---

## Backend

The backend lives in `node-server/`. It is a small Fastify application composed
of four layers with a strict dependency direction: **api → agent, api → db**. The
agent and db layers know nothing about each other or about routing.

```
node-server/src/
├── server.ts              Fastify bootstrap: CORS, plugin/route registration,
│                          startup migrations, graceful shutdown
├── agent/
│   └── index.ts           System prompt + Claude streaming generator
├── api/
│   ├── sessions.ts        REST routes + zod schemas
│   └── websocket.ts       WS handler (/ws/:session_id) — the message loop
└── db/
    ├── client.ts          pg.Pool + Drizzle instance; Db / DbExecutor types
    ├── schema.ts          Drizzle table definitions + inferred row types
    ├── migrate.ts         Startup migration runner (also `npm run db:migrate`)
    └── repositories/
        ├── sessions.ts    Query logic for the sessions table
        └── messages.ts    Query logic for the messages table
```

Each folder carries a `*_CONTEXT.md` explaining the "why" behind its design:
`db/DB_CONTEXT.md`, `api/API_CONTEXT.md`, `agent/AGENT_CONTEXT.md`.

### `server.ts` — composition root

Loads `dotenv`, constructs the Fastify instance, registers CORS (credentialed,
scoped to `ALLOWED_ORIGINS`), the WebSocket plugin, and the two route plugins.
On boot it runs pending migrations **before** listening, and it wires `SIGINT`/
`SIGTERM` to close the server and drain the pg pool. Port defaults to `8000`
locally; the container sets `PORT=8080`.

### `api/` — the HTTP and WebSocket surface

Each route file is a `FastifyPluginAsync` covering one domain and owns its zod
request/response schemas (zod plays the role Pydantic did in the earlier design:
parse input, shape output explicitly). Routes import `db` directly and delegate
all queries to `db/repositories/`; they never build SQL themselves.

- **`sessions.ts`** — `POST /sessions` and `GET /sessions/{id}/history`.
- **`websocket.ts`** — `/ws/:session_id`, the real-time turn loop. This is the
  only file in the backend that touches the agent layer.

### `agent/` — the LLM layer

Intentionally isolated from routing and the database — its only job is to talk to
Claude. `index.ts` owns two things:

- **The system prompt** — defines the shopping-assistant persona, isolated so it
  can be tuned without touching any other layer.
- **`streamResponse(messages)`** — an async generator that takes conversation
  history and yields Claude's reply as text chunks as they arrive.

The generator filters on `content_block_delta` events with a `text_delta` delta,
so if thinking blocks or other block types are enabled later, they will not leak
into the user-visible stream. `cache_control: { type: "ephemeral" }` is set on
the system-prompt block; see [prompt caching](#prompt-caching) for the caveat.

The Anthropic TS SDK is async and non-blocking by construction, so a single
process serves concurrent streams without blocking the event loop.

### `db/` — persistence

`client.ts` is the single dependency point: it owns the `pg.Pool` and the Drizzle
instance built on top of it. Because `pg` pools connections internally, there is
no session factory and no request-scoped injection — callers import `db` directly
and the pool hands out a connection per query.

Repositories accept a **`DbExecutor`** — either the pool-backed `db` or a
transaction handle from `db.transaction(...)`. That single type is what lets the
same repository function run inside or outside a transaction, which the WebSocket
layer relies on for its per-turn transaction scoping.

`DATABASE_URL` is normalized in `client.ts`: a legacy `postgresql+asyncpg://`
scheme is rewritten to plain `postgresql://`, so a stale `.env` keeps working.

---

## Data model

```sql
sessions
  id          UUID PRIMARY KEY          -- app-generated (crypto.randomUUID)
  title       TEXT NOT NULL             -- e.g. "New Session" or a chosen title
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()

messages
  id          UUID PRIMARY KEY          -- app-generated (crypto.randomUUID)
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
  role        TEXT NOT NULL             -- 'user' | 'assistant'
  content     TEXT NOT NULL
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()

-- index backing the history query (session_id filter + created_at ordering)
messages_session_id_created_at_idx ON messages (session_id, created_at)
```

- **App-generated UUIDs.** IDs are minted in the application via
  `crypto.randomUUID` rather than by `gen_random_uuid()`, so no `pgcrypto`
  extension is required and the ID is known before the insert returns.
- **Claude-shaped messages.** Rows are stored in the exact `role`/`content` shape
  the Claude API expects, so replaying history into context requires no
  transformation.
- **Cascade delete.** Deleting a session removes its messages via the FK.

Schema lives in `db/schema.ts`; the generated SQL lives in
`node-server/drizzle/`. Migrations are versioned files applied by `migrate.ts` on
startup — replacing any "create tables on boot" approach, which can create
missing tables but can never alter existing ones. After editing `schema.ts`, run
`npm run db:generate` and commit the generated SQL; never hand-edit a migration
that has already been applied anywhere.

---

## Runtime flows

### Session creation and history (REST)

- **`POST /sessions`** `{ title? }` → creates a row (title defaults to
  `"New Session"`), returns `{ id, title, created_at }`.
- **`GET /sessions/{id}/history`** → messages oldest-first, backed by the
  `(session_id, created_at)` index. Returns `404` if the session doesn't exist.

### A chat turn (WebSocket)

The client opens one long-lived socket per session and sends one frame per user
turn. The handler processes turns strictly in order and scopes database work
tightly around the LLM call:

```
1. Client sends:  { "message": "I need a laptop under $800" }
2. Transaction A:  look up session → load prior history → save user message
      (if the session doesn't exist → send { type: "error" }, keep socket open)
3. Build messages array:  [...history, new user message]
4. Stream from Claude:  for each text chunk → send { type: "chunk", text }
5. Transaction B:  save the assembled assistant message
6. Send:  { type: "done" }
```

Key properties of this loop:

- **Two short transactions per turn, none held across the stream.** One held open
  for the socket's lifetime would pin a pooled connection for as long as the tab
  stays open and would leave a transaction open across the entire LLM stream.
  Transaction A does the pre-stream reads/writes; Transaction B persists the
  result. The Claude call happens between them with no transaction open.
- **In-order processing via a promise queue.** Socket `message` events can fire
  while a previous turn is still streaming. The handler chains them through a
  promise queue so turns never interleave their `chunk` frames or race on writing
  history.
- **Session-not-found stays connected.** A failed lookup sends an `error` frame
  and keeps the socket open for the next message — it does not close. Closing
  would leave the UI dead, because the frontend has no reconnect logic.
- **Disconnect mid-stream still persists the turn.** `send()` is a no-op on a
  closed socket, so if the client vanishes mid-turn the stream still drains and
  the assistant message is still saved. The turn was already paid for, and the
  saved message is what lets a reconnecting client recover it — provided it
  re-fetches history (see [Known gaps](#known-gaps)).

### WebSocket protocol

```jsonc
// client → server (one per user turn)
{ "message": "I need a laptop under $800" }

// server → client
{ "type": "chunk", "text": "..." }         // one per streamed text delta
{ "type": "done" }                          // end of the assistant turn
{ "type": "error", "message": "Session not found" }  // socket stays open
```

The connection is long-lived and stays open across turns, including after an
`error` frame.

### Prompt caching

`cache_control: { type: "ephemeral" }` marks the system-prompt block so the API
can cache that byte-identical prefix and skip reprocessing it. **Caveat:** the
current prompt is ~60 tokens, far under the minimum cacheable prefix
(1024–4096 tokens depending on model), so caching does not engage yet and
`usage.cache_read_input_tokens` will read `0`. The marker is in place at no cost
so caching starts automatically once the prompt grows — zero cache reads today is
expected, not a bug.

---

## Frontend

A React + Vite single-page app in `frontend/`. It is intentionally thin: create a
session, open a socket, render streamed tokens.

```
frontend/src/
├── main.tsx                    Vite entry
├── App.tsx                     Renders <ChatWindow />
├── api/sessions.ts             REST: createSession, getHistory
├── hooks/useWebSocket.ts       Connect, send, dispatch chunk/done/error
├── components/chat/
│   ├── ChatWindow.tsx          Screen: session lifecycle + message state
│   ├── MessageBubble.tsx       One message bubble
│   └── InputBar.tsx            Text input + send
└── types/index.ts              Message, Session
```

**Flow.** On load, `ChatWindow` calls `POST /sessions` and stores the returned
`sessionId`. `useWebSocket` opens `ws(s)://<backend>/ws/{sessionId}` and exposes
`sendMessage`. When the user sends, the message is appended locally and pushed
over the socket; incoming `chunk` frames accumulate into a live streaming bubble,
`done` finalizes it into the message list and re-enables the input, and `error`
clears the streaming state.

**IDs are server-authoritative.** Client-side message `id`s are used only as React
list keys and come from `crypto.randomUUID()` with a plain-counter fallback
(`crypto.randomUUID` is undefined outside secure contexts, e.g. plain-HTTP LAN
access). The persisted UUIDs always come from the server.

**Config.** `VITE_API_URL` (REST base) and `VITE_WS_URL` (WebSocket base) are read
at build time by Vite. `VITE_WS_URL` has a stale LAN-IP fallback, so it must be
set explicitly — otherwise REST works but the chat silently never connects.

---

## Configuration

### Backend — `node-server/.env`

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Read automatically by the Anthropic SDK. |
| `DATABASE_URL` | — | Required. `postgresql://postgres:postgres@localhost:5432/shopping`. |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origin(s), comma-separated. |
| `PORT` | `8000` | The container image sets `8080`. |
| `HOST` | `0.0.0.0` | |

### Frontend — `frontend/.env`

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | REST base URL. |
| `VITE_WS_URL` | *(stale LAN IP)* | **Must be set** — default is a stale LAN address. |

See [`../README.md`](../README.md) for the full local-setup walkthrough (native
Postgres, backend, frontend) and common commands.

---

## Deployment

Target is **Google Cloud Platform**: Cloud Run for the backend and frontend,
Cloud SQL for Postgres.

| Service | Purpose |
|---|---|
| Cloud Run | Backend (Node/Fastify) and frontend (static React) |
| Cloud SQL | Managed PostgreSQL (`db-f1-micro` to start) |
| Cloud SQL Auth Proxy | Sidecar on Cloud Run — avoids VPC Connector cost |
| Secret Manager | `ANTHROPIC_API_KEY`, `DATABASE_URL` |

**No Docker.** Deploys build straight from the source tree with Cloud Buildpacks —
there is no Dockerfile to maintain and no local Docker or Compose to install.
Cloud Run detects the Node app, builds it, and runs the container it produces,
which listens on the `$PORT` it injects. A deploy is a single `gcloud` command:

```bash
gcloud run deploy salamander-server --source .
```

**WebSockets need two non-default Cloud Run flags on the backend service**, or
long-lived chat sockets drop mid-conversation:

```bash
gcloud run deploy salamander-server --source . \
  --session-affinity \   # route a session's requests to the same instance (best-effort)
  --timeout=3600 \       # max connection lifetime; the 300s default drops idle chats
  --min-instances=1      # avoid cold-start latency on the first token
```

`--timeout` caps how long a single request — including a WebSocket — may stay
open; 3600s is the maximum, so a socket still dies at the hour mark and the client
must handle reconnection. `--session-affinity` is best-effort: a scale-down or
instance replacement still cuts live sockets. Because the server is stateless,
none of this loses durable data — it is purely a client-side reconnect concern.

Production secrets come from Secret Manager; `ALLOWED_ORIGINS` is set to the
frontend's origin for credentialed CORS. Cloud Run injects `PORT` automatically.

---

## Known gaps

- **No client-side WebSocket reconnect.** `frontend/src/hooks/useWebSocket.ts`
  opens the socket once per `sessionId` and has no `onclose` handler. When the
  socket drops — Cloud Run timeout, scale-down, laptop sleep, flaky network — the
  chat silently stops working until a page reload, with no user-visible error.
  The Cloud Run flags above reduce how often this happens but cannot eliminate it.
  Closing the gap means adding to the hook: (1) reconnect with capped exponential
  backoff; (2) a visible "reconnecting" UI state; and, most importantly, (3)
  re-fetching `GET /sessions/{id}/history` after reconnect, since the server
  persists the assistant message before sending `done` — a client that dropped
  mid-stream and reconnected without re-reading history would be missing a turn
  that exists in the database.

---

## Key design decisions

- **WebSocket over HTTP polling** — real-time token streaming needs a persistent
  connection.
- **Stateless backend** — no per-connection memory; history is re-read from
  Postgres every turn. A dropped socket costs nothing durable, which is what makes
  best-effort session affinity and horizontal scaling acceptable.
- **Per-turn transaction scoping** — two short transactions bracket each turn with
  no transaction open across the LLM stream, so a pooled connection is never
  pinned for the socket's lifetime.
- **In-order turn queue** — turns are chained through a promise queue so concurrent
  `message` events can't interleave chunks or race on history writes.
- **Messages stored in Claude's role/content shape** — no transformation when
  replaying history into context.
- **App-generated UUIDs** — no `pgcrypto` dependency, and the ID exists before the
  insert round-trips. UUID session IDs also make a future `user_id` FK a clean add.
- **Explicit migrations over sync-on-startup** — `drizzle-kit` produces versioned
  SQL applied at boot, which can alter existing tables, not just create missing
  ones.
- **Prompt caching marker on the system prompt** — free to add now, saves cost as
  the prompt and conversations grow.
- **Cloud SQL Auth Proxy sidecar** — avoids VPC Connector cost; the proxy runs as a
  sidecar container on Cloud Run.
- **One language end to end** — shared types and tooling across backend and
  frontend; ML work would arrive as a separate service.

---

## Roadmap

Phase 1 (this document) is the foundation. The forward-looking product direction —
turning the chat assistant into an inventory-aware shopping **agent** — is
specified in full in [`PRD.md`](PRD.md). In brief, later phases add:

- **Accounts, authentication & sessions** — self-hosted email + password with a
  JWT session cookie; every domain object owned by exactly one user; auth enforced
  on every REST route and at the WebSocket handshake. `sessions` gains a
  `user_id` FK.
- **Inventory domain** — user-defined categories and stock levels, with a
  natural-language-first input model (free text → LLM parse → confirm-before-commit).
- **Mandates, grants & budgets** — deterministic reorder triggers, per-item spend
  caps, and per-period/category budgets.
- **Reorder scheduler & LLM fallback** — evaluates triggers, resolves products,
  and assembles a ready-to-checkout cart.
- **Assisted ordering** — the agent builds the cart and notifies the user, who
  reviews and places the order manually. Fully autonomous checkout is a guarded
  stretch goal.

The PRD is the authority for that scope; this file stays focused on the shipped
architecture and is updated as each phase lands.
