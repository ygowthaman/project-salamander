# Salamander — Architecture

Salamander is a shopping agent: it tracks what a user owns and, when stock runs low,
assembles a ready-to-checkout cart for the user to place. This document is the
source of truth for how the system is built — its layers, data model, runtime
flows, deployment shape, and the decisions behind them.

> ### ⚠️ This document describes the target architecture, not the current code
>
> **What is running today is still the Phase 1 chat app**: a streaming chat
> assistant with `sessions` + `messages` tables, `POST /sessions`,
> `GET /sessions/{id}/history`, a token-streaming WebSocket at `/ws/:session_id`,
> and a React chat UI.
>
> **That chat app is to be removed** — tables, routes, handler, and UI — as
> prerequisite work before roadmap Phase 1 begins. It has not been removed yet.
> Everything below describes the architecture that replaces it.
>
> Where a section describes something that does not exist yet, it is marked
> **(planned)**. Treat this file as the specification for the work, and
> [`ROADMAP.md`](ROADMAP.md) for its sequencing.

- **What exists today:** the Phase 1 chat app (above), on a foundation of Fastify
  bootstrap, Postgres + Drizzle with migrations applied on startup, the Anthropic
  SDK, and a Vite frontend. No auth, no domain tables.
- **What gets removed first:** the entire chat surface — see
  [Removing the chat app](#removing-the-chat-app) for the checklist.
- **Where it's going:** accounts, inventory, mandates, budgets, a reorder
  scheduler, and assisted cart-building — specified in [`PRD.md`](PRD.md) and
  sequenced in [`ROADMAP.md`](ROADMAP.md).

The single most important thing to understand before touching this codebase is
[The role of the LLM](#the-role-of-the-llm) below: Salamander is to have **no
conversational surface**, and the model becomes an interpreter rather than an
assistant.

---

## The role of the LLM

**The user never converses with a model.** The LLM is an *interpreter* sitting
behind the UI: wherever the app needs structured data, the user types a plain
sentence and the model converts it into the DTO the server persists.

```
plain text → LLM interprets → DTO → server validates + commits → WS push → UI updates
```

The user types *"Add 1984 to my Books"*; the model returns
`{ category: "Books", name: "1984", … }`; the server validates it with zod, writes
the row, and pushes the new record over that user's WebSocket; the UI clears the
input and the row appears in the table.

Every LLM call in the system is **single-turn, non-streaming, and stateless**, and
returns **structured output** — never prose shown directly to a user. Four jobs,
one shape:

| Job | Input | Output |
|---|---|---|
| **Interpretation** — the dominant case | free text + target schema + context | a DTO the server commits |
| **Search interpretation** | free text | a query DTO the server runs (rows never return to the model) |
| **Selection** | provider candidates + a grant | which product goes on a line item |
| **Judgment** | a grant miss + budget headroom | one action from a fixed set |

Architectural consequences, which run through everything below:

- **No conversation state** — no `messages` table, no chat session, no history
  assembly. Each call is independent, so there is nothing per-user to keep in
  memory or replay.
- **No token streaming** — responses are awaited whole and validated before use.
- **The WebSocket carries data, not tokens** — it is a per-user push channel for
  row changes (see [Push channel](#the-websocket-push-channel)).
- **The server, not the model, decides what the user sees.** A model response is
  an input to application logic, never output to the browser.

---

## Removing the chat app

**Status: not started.** This is prerequisite work — it lands before roadmap
Phase 1a, not as part of it. Nothing in the rest of this document is buildable on
top of the chat surface, because the two disagree about what the LLM layer and the
WebSocket are *for*.

What has to go:

| Area | Files / objects | Notes |
|---|---|---|
| Backend routes | `src/api/sessions.ts`, `src/api/websocket.ts` | The only consumers of the agent layer today |
| LLM layer | `src/agent/index.ts` | Streaming chat generator + assistant system prompt |
| Repositories | `src/db/repositories/{sessions,messages}.ts` | |
| Schema | `sessions` + `messages` in `src/db/schema.ts` | Plus a drop migration — see below |
| Frontend | `components/chat/`, `hooks/useWebSocket.ts`, `api/sessions.ts`, `types/index.ts` | `App.tsx` needs a new root |
| Composition root | Route registrations in `src/server.ts` | Leaves the app with no routes until auth lands |

Notes on doing it:

- **The `@fastify/websocket` registration stays.** The plugin is reused by the
  per-user push channel; only the chat *route* goes.
- **Write a drop migration, don't edit `0000_init.sql`.** Drop `messages` before
  `sessions` — the FK points that way. Never hand-edit a migration that has
  already been applied.
- **`drizzle-kit generate` cannot diff this repo.** `meta/*_snapshot.json` was
  never committed (`0000_init` has none either), so the drop migration and its
  `meta/_journal.json` entry have to be hand-written. Worth fixing the snapshot
  gap before the auth migrations land, or `generate` will keep misbehaving.
- **Local dev databases carry chat rows.** The drop is destructive; the data is
  throwaway, but say so rather than surprising someone.
- **The backend is left with no routes.** Add a `GET /health` in the same change
  so the service stays verifiable and deployable until auth arrives.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| Backend | Node.js 20 + TypeScript + Fastify |
| LLM | Claude API via the Anthropic TypeScript SDK |
| Real-time | WebSockets (`@fastify/websocket`) — server→client push only |
| Database | PostgreSQL 16 + Drizzle ORM over `pg` (node-postgres) |
| Migrations | `drizzle-kit` — versioned SQL applied on server startup |
| Validation | zod — at the HTTP boundary *and* on every LLM response |
| Local dev DB | Local PostgreSQL 16 |
| Deployment | Google Cloud Platform — see [Deployment](#deployment) |

One language end to end: backend and frontend are both TypeScript, so types,
tooling, and mental model are shared. A future ML workload would be added as a
separate service rather than pulling the backend into another language.

---

## Runtime topology

```
Browser (React SPA)
  │
  │  HTTPS (REST)  +  WSS (push, server→client only)
  ▼
Frontend — static React build (Vite) served by a web server / CDN
  │
  │  REST: every user action, including every natural-language input
  │  WS:   /ws — one per authenticated user; receives row changes
  ▼
Backend — Node + Fastify
  ├── REST routes ......... src/api/*
  ├── Push channel ........ src/api/websocket.ts
  ├── Agent (Claude) ...... src/agent/*  ──► Anthropic API (non-streaming)
  └── DB access ........... src/db/*
  │
  ▼
PostgreSQL
```

The backend holds **no per-connection conversational state**. All durable state
lives in Postgres, and every LLM call carries its own context assembled from the
database at call time. The push channel holds only a socket handle per user, and
losing it costs nothing durable — every view is re-fetchable over REST.

---

## Backend

The backend lives in `node-server/`. It is a small Fastify application composed of
layers with a strict dependency direction: **api → agent, api → db**. The agent
and db layers know nothing about each other or about routing.

The layout below is the **target**: the folders exist today, but `agent/` holds the
chat generator and `api/` holds the chat routes until the removal lands.

```
node-server/src/
├── server.ts              Fastify bootstrap: CORS, plugin/route registration,
│                          startup migrations, graceful shutdown
├── agent/                 LLM layer — interpretation functions (one per target),
│                          each owning its prompt + tool schema
├── api/                   REST route plugins + the WebSocket push channel
└── db/
    ├── client.ts          pg.Pool + Drizzle instance; Db / DbExecutor types
    ├── schema.ts          Drizzle table definitions + inferred row types
    ├── migrate.ts         Startup migration runner (also `npm run db:migrate`)
    └── repositories/      Query logic, one module per table
```

Each folder carries a `*_CONTEXT.md` explaining the "why" behind its design:
`db/DB_CONTEXT.md`, `api/API_CONTEXT.md`, `agent/AGENT_CONTEXT.md`.

### `server.ts` — composition root

Loads `dotenv`, constructs the Fastify instance, registers CORS (credentialed,
scoped to `ALLOWED_ORIGINS`), the WebSocket plugin, and the route plugins. On boot
it runs pending migrations **before** listening, and wires `SIGINT`/`SIGTERM` to
close the server and drain the pg pool. Port defaults to `8000` locally; the
container sets `PORT=8080`.

### `api/` — the HTTP surface

**(planned — today this folder holds `sessions.ts` and the streaming
`websocket.ts`.)**

Each route file is a `FastifyPluginAsync` covering one domain and owns its zod
request/response schemas. Routes import `db` directly and delegate all queries to
`db/repositories/`; they never build SQL themselves.

Routes that accept natural language call an agent-layer interpretation function,
validate what comes back, and then either commit it or return it as a draft — see
[The interpret flow](#the-interpret-flow).

### `agent/` — the LLM layer

**(planned — today `agent/index.ts` is the chat streaming generator.)**

Intentionally isolated from routing and the database — its only job is to talk to
Claude. It exposes one **interpretation function per target** (inventory items,
stock updates, search queries, mandates/grants, product selection, fallback
judgment), each owning:

- **Its prompt** — isolated so it can be tuned without touching any other layer.
- **Its tool/output schema** — the tool's `input_schema` *is* the target schema,
  so the model must return schema-shaped JSON rather than prose to be regexed.

Callers pass context (e.g. the user's item names and ids) and get back parsed,
schema-shaped data. The agent layer performs no database access and no writes; it
receives the context it needs as arguments. This is what keeps `user_id` scoping
a server-side concern the model cannot influence.

The Anthropic TS SDK is async and non-blocking by construction, so a single
process serves concurrent interpretation calls without blocking the event loop.

### `db/` — persistence

`client.ts` is the single dependency point: it owns the `pg.Pool` and the Drizzle
instance built on top of it. Because `pg` pools connections internally, there is
no session factory and no request-scoped injection — callers import `db` directly
and the pool hands out a connection per query.

Repositories accept a **`DbExecutor`** — either the pool-backed `db` or a
transaction handle from `db.transaction(...)`. That single type is what lets the
same repository function run inside or outside a transaction, which the
interpret-and-commit flow relies on to write a row and its audit event atomically.

`DATABASE_URL` is normalized in `client.ts`: a legacy `postgresql+asyncpg://`
scheme is rewritten to plain `postgresql://`, so a stale `.env` keeps working.

---

## Data model

**Today the schema holds exactly two tables — `sessions` and `messages` — and both
are to be dropped** with the chat app (see
[Removing the chat app](#removing-the-chat-app)). There are no domain tables yet;
`users` + `auth_sessions` + `inventory_items` arrive with roadmap Phase 1.

The target model is specified in [`PRD.md` §6](PRD.md). The conventions it
inherits, which any new table should follow:

- **App-generated UUIDs.** IDs are minted in the application via
  `crypto.randomUUID` rather than by `gen_random_uuid()`, so no `pgcrypto`
  extension is required and the ID is known before the insert returns.
- **Every user-owned table carries `user_id UUID NOT NULL REFERENCES users(id)
  ON DELETE CASCADE`**, and is indexed on `(user_id, …)` for its common list
  query. Account deletion then cascades without bespoke cleanup.
- **`jsonb` only for genuinely open-ended fields** (item `attributes`, fallback
  decisions, notification payloads) — validated with zod at the boundary. Things
  that get queried or constrained are real columns.

Schema lives in `db/schema.ts`; the generated SQL lives in `node-server/drizzle/`.
Migrations are versioned files applied by `migrate.ts` on startup — replacing any
"create tables on boot" approach, which can create missing tables but can never
alter existing ones. After editing `schema.ts`, run `npm run db:generate` and
commit the generated SQL; never hand-edit a migration that has already been
applied anywhere.

---

## Runtime flows

**Both flows below are planned.** Neither exists in the code yet — today the only
runtime flow is the chat turn loop in `api/websocket.ts`, which both of these
replace.

### The interpret flow

This is the application's characteristic flow — every natural-language input in
the product runs through it:

```
1. Client POSTs free text:  { "text": "Add 1984 to my Books" }
2. Assemble context:        the user's item names + ids, and for stock updates
                            each named item's current_stock / par_level / unit /
                            mandate threshold
3. Interpret:               agent-layer call → structured JSON via tool use
4. Validate:                the SAME zod schema the route would accept directly.
                            Invalid / low-confidence / unresolved → 422 with the
                            partial parse. NOTHING is written.
5. Commit or draft:         per module (below)
6. Push:                    broadcast the changed rows on the user's WS channel
7. Respond:                 the applied change (or the draft), so the UI can
                            clear the input and show what happened
```

Steps 1–4 are identical everywhere. Step 5 is the only variable, and it is a
**per-module decision** (PRD §5.0):

| | Direct commit | Confirm-before-commit |
|---|---|---|
| Step 5 | write immediately | return a draft; a second request commits it |
| Round trips | one | two |
| Used by | inventory adds & stock updates | mandates, grants |

Validation is not what varies. A failed interpretation persists nothing under
either pattern — direct commit skips the *human approval* step, not the schema
gate. Because both patterns share steps 1–4, a module can switch later by adding
or removing a `/parse` route and a UI step, not by rewriting its extractor.

### The WebSocket push channel

One socket per authenticated user, opened after login. It reuses the
`@fastify/websocket` plugin already registered in `server.ts`, replacing the chat
socket's route with a channel that runs in the opposite direction.

- **Auth happens at the handshake** — the cookie rides along with the WS upgrade.
  Unauthenticated upgrades are rejected.
- **The channel is derived server-side** from the authenticated user id. The
  client never names it, so there is no path parameter to forge.
- **Server → client only.** The client sends nothing; every user action is a REST
  call. This is a notification bus, not an RPC transport.
- **Payloads are typed data events**, not text:

```jsonc
{ "type": "inventory.upserted",   "items": [ { "id": "…", "name": "1984", … } ] }
{ "type": "inventory.deleted",    "ids": ["…"] }
{ "type": "cart.updated",         "order_id": "…", "total_price": "42.10" }
{ "type": "notification.created", "notification": { … } }
```

The channel exists because two different things change rows the user is looking
at: their own interpret-and-commit calls, and background reorder runs with no
request in flight at all. One delivery path covers both.

**It is an optimization, never the source of truth.** Every view is fetchable over
REST, so a dropped socket degrades the UI to stale-until-refresh rather than
breaking it — which matters given the reconnect gap below and Cloud Run's
one-hour cap on socket lifetime.

---

## Configuration

### Backend — `node-server/.env`

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Read automatically by the Anthropic SDK. |
| `DATABASE_URL` | — | Required. `postgresql://postgres:postgres@localhost:5432/shopping`. |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origin(s), comma-separated. Credentialed CORS means this must name the frontend origin exactly — no wildcards. |
| `PORT` | `8000` | The container image sets `8080`. |
| `HOST` | `0.0.0.0` | |
| `JWT_SECRET` | — | Required once auth lands; Secret Manager in prod. |

### Frontend — `frontend/.env`

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | REST base URL. |
| `VITE_WS_URL` | *(stale LAN IP)* | **Must be set** — the default is a stale LAN address. |

See [`../README.md`](../README.md) for the full local-setup walkthrough and common
commands.

---

## Deployment

Target is **Google Cloud Platform**. [`DEPLOYMENT.md`](DEPLOYMENT.md) is the
as-built runbook and takes precedence over this section where they differ — most
notably, the live deployment runs **Postgres on a Compute Engine VM reached via
Direct VPC egress**, not Cloud SQL, and serves the frontend from Firebase
Hosting.

| Service | Purpose |
|---|---|
| Cloud Run | Backend (Node/Fastify) |
| Firebase Hosting | Frontend (static React build) |
| Compute Engine VM | PostgreSQL (self-managed; Cloud SQL is the growth path) |
| Secret Manager | `ANTHROPIC_API_KEY`, `DATABASE_URL`, `JWT_SECRET` |

**No Docker.** Deploys build straight from the source tree with Cloud Buildpacks —
there is no Dockerfile to maintain and no local Docker or Compose to install.
Cloud Run detects the Node app, builds it, and runs the container it produces,
which listens on the `$PORT` it injects.

**The push channel still needs non-default Cloud Run flags**, or long-lived
sockets drop:

```bash
gcloud run deploy salamander-server --source . \
  --session-affinity \   # route a user's requests to the same instance (best-effort)
  --timeout=3600 \       # max connection lifetime; the 300s default drops idle sockets
  --min-instances=1      # avoid cold-start latency
```

`--timeout` caps how long a single request — including a WebSocket — may stay
open; 3600s is the maximum, so a socket still dies at the hour mark and the client
must reconnect. `--session-affinity` is best-effort: a scale-down or instance
replacement still cuts live sockets.

Because the push channel is an optimization rather than the source of truth, none
of this loses durable data. A dropped socket means the UI is stale until the next
REST fetch — no more. That is a materially weaker requirement than it was for
token streaming, where a dropped socket lost the response mid-sentence.

---

## Known gaps

- **No client-side WebSocket reconnect.** `frontend/src/hooks/useWebSocket.ts`
  has no `onclose` handling today, and the push channel that replaces it inherits
  the gap unless it is fixed deliberately. A dropped socket — Cloud Run timeout, scale-down, laptop sleep, flaky
  network — silently stops live updates until a page reload. Closing the gap
  means (1) reconnect with capped exponential backoff, (2) a visible
  "reconnecting" state, and (3) re-fetching the affected views on reconnect,
  since pushes sent while disconnected are simply missed. The push channel's
  best-effort contract keeps this from being data loss, but the UI does go stale
  without telling the user.
- **Prompt caching is unproven at this size.** `cache_control: { type:
  "ephemeral" }` belongs on the interpretation prompts, whose static prefix
  (instructions + JSON schema) should clear the 1024-token minimum comfortably —
  unlike the ~60-token chat prompt it replaces, which never engaged caching at
  all. Verify `usage.cache_read_input_tokens` is non-zero once the first
  extractor ships rather than assuming it.

---

## Key design decisions

- **The LLM is an interpreter, not a conversationalist** — every call is
  single-turn, non-streaming, structured-output. This removes conversation state,
  history replay, and token streaming from the system entirely, and it is why the
  backend can stay stateless without any session-affinity requirement for
  correctness.
- **Validate every model response with the same zod schema the route uses** — a
  model response is untrusted input. This gate, not the UI confirm step, is what
  guarantees a bad parse never reaches the database.
- **Commit policy is per module** — direct commit for cheap, reversible, everyday
  writes; confirm-before-commit where a misread spends money. Both share one
  interpretation core, so the choice is reversible.
- **`user_id` is bound server-side, never taken from the model** — an
  interpretation result names *what* to write, never *whose* row to touch.
- **WebSocket as a best-effort push channel, not a transport** — server→client
  only, REST remains the source of truth, so socket loss degrades freshness
  rather than function.
- **App-generated UUIDs** — no `pgcrypto` dependency, and the ID exists before the
  insert round-trips.
- **Explicit migrations over sync-on-startup** — `drizzle-kit` produces versioned
  SQL applied at boot, which can alter existing tables, not just create missing
  ones.
- **One language end to end** — shared types and tooling across backend and
  frontend; ML work would arrive as a separate service.

---

## Roadmap

The forward-looking product direction is specified in full in [`PRD.md`](PRD.md)
and sequenced into phases in [`ROADMAP.md`](ROADMAP.md). In brief:

1. **Accounts, authentication & sessions** — email + password with a JWT session
   cookie, auth enforced on every REST route and at the WebSocket handshake, plus
   the per-user push channel.
2. **Inventory** — user-defined categories and stock levels, with
   natural-language input (direct commit) alongside precise CRUD.
3. **Search, mandates, grants & budgets** — NL inventory search, deterministic
   reorder triggers, per-item spend caps, and per-period category budgets.
4. **Carts** — product resolution against a shopping provider, cart review, and
   manual placement. The app never completes a checkout.
5. **Automation** — a reorder scheduler with windows, the LLM fallback decision,
   and notifications.

This file stays focused on the architecture as built, and is updated as each
phase lands.
