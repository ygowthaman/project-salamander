# Salamander — Architecture

Salamander is a shopping agent. Today it is a chat web app: a user describes what
they want to buy and Claude streams back suggestions in real time. This document
is the source of truth for how the system is built — its layers, data model,
runtime flows, deployment shape, and the decisions behind them.

- **What exists today:** LLM connectivity, WebSocket token streaming, session
  persistence, and **authentication** — user accounts via Google OAuth and
  email + password, with every chat session owned by a user. No external search
  APIs, no payments.
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
| Auth | Google OAuth 2.0 (OIDC + PKCE) and email + password (argon2id); JWT access cookie via `jose` |
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
├── server.ts              Bootstrap: migrations, listen, graceful shutdown
├── app.ts                 Composition root: builds the wired Fastify instance
├── agent/
│   └── index.ts           System prompt + Claude streaming generator
├── auth/
│   ├── config.ts          Env resolution (Google credentials optional)
│   ├── tokens.ts          Access-JWT sign/verify; refresh mint + hash
│   ├── cookies.ts         Cookie names, scopes and flags
│   ├── password.ts        argon2id hashing and constant-cost verification
│   ├── google.ts          PKCE authorize URL, code exchange, ID-token verify
│   └── plugin.ts          Root-level identify / CSRF / Origin hooks
├── api/
│   ├── auth.ts            /auth/* routes + zod schemas
│   ├── sessions.ts        REST routes + zod schemas
│   └── websocket.ts       WS handler (/ws/:session_id) — the message loop
└── db/
    ├── client.ts          pg.Pool + Drizzle instance; Db / DbExecutor types
    ├── schema.ts          Drizzle table definitions + inferred row types
    ├── migrate.ts         Startup migration runner (also `npm run db:migrate`)
    └── repositories/
        ├── users.ts          Query logic for the users table
        ├── oauthAccounts.ts  Provider identity links
        ├── authSessions.ts   Refresh-token records and revocation
        ├── sessions.ts       Query logic for the sessions table
        └── messages.ts       Query logic for the messages table
```

Each folder carries a `*_CONTEXT.md` explaining the "why" behind its design:
`db/DB_CONTEXT.md`, `api/API_CONTEXT.md`, `agent/AGENT_CONTEXT.md`,
`auth/AUTH_CONTEXT.md`.

### `app.ts` / `server.ts` — composition root

`app.ts` builds the fully-wired Fastify instance without binding a port: CORS
(credentialed, scoped to `ALLOWED_ORIGINS`, explicitly allowing `X-CSRF-Token`),
rate limiting, cookie parsing and the global auth hooks, the WebSocket plugin,
and the three route plugins. Keeping it separate from the listen bootstrap is
what lets `npm test` exercise the guards with `app.inject()` and no database.

`server.ts` loads `dotenv`, calls `buildApp()`, runs pending migrations **before**
listening, and wires `SIGINT`/`SIGTERM` to close the server and drain the pg
pool. Port defaults to `8000` locally; the container sets `PORT=8080`.

### `auth/` — identity

Owns accounts, credentials and session cookies; knows nothing about chat. A
15-minute access JWT rides in an httpOnly cookie (so the WebSocket upgrade
carries it automatically), backed by opaque, rotating refresh tokens whose
SHA-256 lives in `auth_sessions` for revocation. Google sign-in is OIDC with
PKCE, linked on the provider's stable `sub` claim. See `auth/AUTH_CONTEXT.md`
for the reasoning, including why the cookie domain dictates the deployment shape.

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
users
  id             UUID PRIMARY KEY
  email          TEXT NOT NULL          -- stored lowercased; UNIQUE index
  password_hash  TEXT                   -- NULL for Google-only accounts
  display_name   TEXT
  avatar_url     TEXT
  email_verified BOOLEAN NOT NULL DEFAULT false
  created_at, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

oauth_accounts                          -- one row per linked provider identity
  id                  UUID PRIMARY KEY
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  provider            TEXT NOT NULL     -- 'google'
  provider_account_id TEXT NOT NULL     -- Google's stable `sub`, never the email
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  UNIQUE (provider, provider_account_id)

auth_sessions                           -- refresh tokens; existence = revocable
  id                 UUID PRIMARY KEY
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  refresh_token_hash TEXT NOT NULL UNIQUE   -- SHA-256; never the raw token
  user_agent, ip     TEXT
  expires_at         TIMESTAMPTZ NOT NULL
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  revoked_at         TIMESTAMPTZ

sessions
  id          UUID PRIMARY KEY          -- app-generated (crypto.randomUUID)
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
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
-- index backing "list my chat sessions, newest first"
sessions_user_id_created_at_idx    ON sessions (user_id, created_at)
```

> **Migration note.** `0001_auth_users_oauth.sql` **deletes all pre-auth chat
> sessions** (and their messages, via the cascade). Those rows were created
> anonymously and have no owner to satisfy the new `NOT NULL user_id`. It is
> also hand-written rather than generated: `drizzle/meta/0000_snapshot.json` was
> never committed, so `drizzle-kit generate` diffed against an empty database and
> emitted `CREATE TABLE IF NOT EXISTS "sessions"` — a silent no-op on a live
> database that would never have added the column. The 0001 snapshot now
> describes the real post-state, so later migrations can go back to being
> generated.

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

### Authentication

Two ways in, one session model.

- **Email + password** — `POST /auth/signup` / `POST /auth/login`. Passwords are
  argon2id. Login returns an identical `401` for unknown-email, wrong-password
  and Google-only accounts, and burns the same wall-clock time in each case, so
  neither the response nor its timing reveals whether an account exists.
- **Google** — `GET /auth/google` redirects to Google with PKCE plus a `state`
  value held in a signed httpOnly cookie; `GET /auth/google/callback` verifies
  `state`, exchanges the code, and validates the ID token against Google's JWKS
  (checking **issuer and audience**).

Either path ends at the same place: a 15-minute access JWT in an httpOnly
cookie, plus an opaque refresh token whose SHA-256 is recorded in
`auth_sessions`. `POST /auth/refresh` **rotates** — it revokes the presented
record and issues a new one — and treats a replayed, already-revoked token as a
compromise signal, revoking every session for that user.

Google identities are linked on the provider's stable `sub`. If the email
matches an existing password account, the two are linked **only when Google
asserts the address is verified**; otherwise the attempt is refused, because
auto-linking an unverified address is an account-takeover path.

```
1. GET /auth/google        → 302 to accounts.google.com   (state + PKCE cookie)
2. user consents           → 302 back to /auth/google/callback?code&state
3. verify state → exchange code → verify ID token (iss + aud)
4. find oauth_accounts by (google, sub)
     hit  → that user
     miss → match on verified email → link, else create user
5. issue access + refresh cookies → 302 to the frontend
```

### Session creation and history (REST)

Both routes require authentication and are scoped to the caller.

- **`POST /sessions`** `{ title? }` → creates a row owned by `request.user`
  (title defaults to `"New Session"`), returns `{ id, title, created_at }`. The
  owner comes from the verified cookie, never from the request body.
- **`GET /sessions/{id}/history`** → messages oldest-first, backed by the
  `(session_id, created_at)` index. Returns `404` if the session doesn't exist
  **or belongs to another user** — a `403` would confirm the id exists.

### A chat turn (WebSocket)

The socket is authenticated **at the handshake** — the auth cookie rides along
with the upgrade request, so an unauthenticated client never gets a socket. The
handshake also validates `Origin`: CORS does not apply to WebSockets, so that
check is the only thing preventing a cross-site page from opening an
authenticated socket.

The client opens one long-lived socket per session and sends one frame per user
turn. The handler processes turns strictly in order and scopes database work
tightly around the LLM call:

```
1. Client sends:  { "message": "I need a laptop under $800" }
2. Transaction A:  look up session FOR THIS USER → load prior history → save user message
      (if it doesn't exist or isn't theirs → send { type: "error" }, keep socket open)
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
- **Ownership is re-checked every turn, not just at the handshake.** The socket
  outlives the 15-minute access token, and the account may be deleted
  mid-connection — which cascades the session away, so the next turn fails
  closed.
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
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origin(s), comma-separated. Also gates mutation `Origin` checks and the WS handshake. |
| `PORT` | `8000` | The container image sets `8080`. |
| `HOST` | `0.0.0.0` | |
| `JWT_SECRET` | *(dev fallback)* | Signs access tokens and the OAuth state cookie. Min 32 chars; **required in production**. |
| `PUBLIC_API_URL` | `http://localhost:8000` | This server's public origin. `${PUBLIC_API_URL}/auth/google/callback` must match an Authorised redirect URI on the OAuth client. |
| `FRONTEND_URL` | `http://localhost:5173` | Where the browser lands after OAuth. |
| `COOKIE_DOMAIN` | *(unset)* | `axoliz.ai` in production so one cookie spans frontend and API. Leave empty locally. |
| `GOOGLE_CLIENT_ID` | *(unset)* | Optional — without it the server runs password-only and `/auth/google` returns 503. |
| `GOOGLE_CLIENT_SECRET` | *(unset)* | As above. |

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

**The backend must be served from `api.axoliz.ai`, not its `run.app` URL.** This
is an auth constraint, not cosmetics. Auth cookies are `SameSite=Lax`, which
means the browser omits them on **cross-site** requests. `run.app` is on the
Public Suffix List, so `salamander-server-….run.app` and `salamander.axoliz.ai`
are different sites — every authenticated call from the frontend would arrive
without a cookie and 401, while working perfectly on localhost. Mapping the
service to `api.axoliz.ai` puts both sides under the `axoliz.ai` registrable
domain, and `COOKIE_DOMAIN=axoliz.ai` issues one cookie that covers both.

The alternative — `SameSite=None; Secure` — would work on the `run.app` URL today
but is a third-party cookie: already blocked by Safari ITP and Firefox, and on
Chrome's deprecation path. See `DEPLOYMENT.md` §8 for the domain mapping steps.

---

## Known gaps

- **Auth flows that touch the database are untested.** `npm test` covers the
  guard layer (tokens, PKCE, CSRF, Origin, auth gating) with no database needed,
  but signup, login, the OAuth callback and refresh rotation have no automated
  coverage. `0001_auth_users_oauth.sql` has also never been applied to a live
  Postgres.
- **No email verification or password reset.** `users.email_verified` is set by
  Google but there is no mail transport, so a password account can never verify
  and a forgotten password cannot be reset. PRD §12.6 still owns that decision.
- **No account-settings UI.** `PATCH /auth/me`, `POST /auth/change-password` and
  `DELETE /auth/me` exist and are enforced, but nothing in the frontend calls
  them yet — sign-in, sign-up and sign-out are the only wired flows.
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
- **Auth cookies over bearer tokens** — httpOnly removes the XSS token-theft
  class, and the cookie rides the WebSocket upgrade automatically (a browser
  cannot set headers on `new WebSocket()`). The cost is that the API must share a
  registrable domain with the frontend.
- **OAuth linked on the provider's `sub`, never email** — a Google account's
  email can change; `sub` cannot. Linking to an existing password account
  requires Google to assert the email is verified, or it is an account-takeover
  path.
- **Opaque, rotating refresh tokens with replay detection** — revocation becomes
  a row update rather than a JWT blocklist, and a replayed token revokes the
  user's whole session family.
- **Constant-cost password verification** — argon2 runs even when the account has
  no password, so timing cannot distinguish "no such user" from "Google-only
  account" from "wrong password".
- **Cloud SQL Auth Proxy sidecar** — avoids VPC Connector cost; the proxy runs as a
  sidecar container on Cloud Run.
- **One language end to end** — shared types and tooling across backend and
  frontend; ML work would arrive as a separate service.

---

## Roadmap

Phase 1 (this document) is the foundation. The forward-looking product direction —
turning the chat assistant into an inventory-aware shopping **agent** — is
specified in full in [`PRD.md`](PRD.md). In brief, later phases add:

- ~~**Accounts, authentication & sessions**~~ — **shipped, described above.**
  Delivered with **Google OAuth in addition to** email + password, which
  overrides PRD §1's password-only lock and §9's "OAuth is a non-goal"; the rest
  of PRD §3 was followed as specified.
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
