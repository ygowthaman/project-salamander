# Salamander — Architecture

Salamander is a shopping agent: it tracks what a user owns and, when stock runs low,
assembles a ready-to-checkout cart for the user to place. This document is the
source of truth for how the system is built — its layers, data model, runtime
flows, deployment shape, and the decisions behind them.

> ### ⚠️ Much of this document is still specification, not code
>
> **The Phase 1 chat app has been removed** — tables, routes, streaming handler,
> and UI (see [Removing the chat app](#removing-the-chat-app)). What is left
> running is authentication and `GET /health`; the interpreter, the domain tables
> and the push channel described below are not built yet.
>
> Where a section describes something that does not exist yet, it is marked
> **(planned)**. Treat this file as the specification for that work, and
> [`ROADMAP.md`](ROADMAP.md) for its sequencing.

- **What exists today:** **authentication** — accounts via Google OAuth and
  email + password, `users` / `oauth_accounts` / `auth_sessions`, auth enforced
  on every route (roadmap Phase 1a, see [Authentication](#authentication)) — plus
  `GET /health`, on a foundation of Fastify, Postgres + Drizzle with migrations
  applied on startup, and a Vite frontend whose signed-in half is a placeholder
  shell. No domain tables, no LLM layer, no WebSocket route.
- **What was just removed:** the entire chat surface — see
  [Removing the chat app](#removing-the-chat-app).
- **Where it's going:** inventory, mandates, budgets, a reorder scheduler, and
  assisted cart-building — specified in [`PRD.md`](PRD.md) and sequenced in
  [`ROADMAP.md`](ROADMAP.md).

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
`{ name: "1984", category_id: "…", … }` — an id resolved from the user's own
categories, or a proposed `new_category` when none matches ([`PRD.md`](PRD.md)
§5.1.1); the server validates it with zod, writes the row, and pushes the new
record over that user's WebSocket; the UI clears the input and the row appears in
the table.

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

**Status: done.** It was prerequisite work — nothing in the rest of this document
was buildable on top of the chat surface, because the two disagree about what the
LLM layer and the WebSocket are *for*.

What went:

| Area | Files / objects |
|---|---|
| Backend routes | `src/api/sessions.ts`, `src/api/websocket.ts` |
| LLM layer | `src/agent/index.ts` — streaming chat generator + assistant system prompt |
| Repositories | `src/db/repositories/{sessions,messages}.ts` |
| Schema | `sessions` + `messages`, dropped by `drizzle/0002_drop_chat.sql` |
| Frontend | `components/chat/`, `hooks/useWebSocket.ts`, `api/sessions.ts`, and the chat types |
| Composition root | The two chat route registrations in `src/app.ts` |

What deliberately stayed, and why it matters to the next change:

- **The `@fastify/websocket` registration**, with no route attached to it. The
  per-user push channel reuses it, so standing that up is a route file rather
  than a dependency decision.
- **`GET /health`** was added in the same change — unauthenticated and
  database-free, so liveness does not depend on an authenticated route now that
  the domain routes do not exist yet.
- **All of auth.** `sessions.user_id` disappeared with its table; `users`,
  `oauth_accounts` and `auth_sessions` never depended on it.
- **The `@anthropic-ai/sdk` dependency**, though nothing imports it today — the
  interpretation layer is the next thing to need it.
- **A placeholder signed-in shell** in the frontend (`components/home/`), so the
  authenticated half of the app stays reachable and sign-out still works. The
  inventory table and its natural-language input replace it.

The drop migration was machine-generated, which works again now that `0001`
committed a drizzle snapshot; it drops `messages` before `sessions`, since the FK
points that way. It is destructive to any local dev database carrying chat rows.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| Backend | Node.js 20 + TypeScript + Fastify |
| LLM | Claude API via the Anthropic TypeScript SDK (`claude-sonnet-4-6`) |
| Real-time | WebSockets (`@fastify/websocket`) — server→client push only |
| Auth | Google OAuth 2.0 (OIDC + PKCE) and email + password (argon2id); JWT access cookie via `jose` |
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
  ├── Auth ................ src/auth/*   ──► cookies, JWT, Google OIDC
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
layers with a strict dependency direction: **api → agent, api → auth, api → db**.
The agent, auth and db layers know nothing about each other or about routing.

The layout below marks **(planned)** on what does not exist yet. Everything
unmarked is in the tree today.

```
node-server/src/
├── server.ts              Bootstrap: migrations, listen, graceful shutdown
├── app.ts                 Composition root: builds the wired Fastify instance
├── agent/                 LLM layer — interpretation functions (one per target),
│                          each owning its prompt + tool schema     (planned:
│                          empty of code since the chat generator was deleted)
├── auth/
│   ├── config.ts          Env resolution (Google credentials optional)
│   ├── tokens.ts          Access-JWT sign/verify; refresh mint + hash
│   ├── cookies.ts         Cookie names, scopes and flags
│   ├── password.ts        argon2id hashing and constant-cost verification
│   ├── google.ts          PKCE authorize URL, code exchange, ID-token verify
│   └── plugin.ts          Root-level identify / CSRF / Origin hooks
├── api/
│   ├── auth.ts            /auth/* routes + zod schemas
│   ├── health.ts          GET /health — unauthenticated, no database
│   ├── categories.ts      (planned) CRUD behind the management page
│   ├── inventory.ts       (planned) CRUD + the interpreted write path
│   └── websocket.ts       (planned) the per-user push channel
└── db/
    ├── client.ts          pg.Pool + Drizzle instance; Db / DbExecutor types
    ├── schema.ts          Drizzle table definitions + inferred row types
    ├── migrate.ts         Startup migration runner (also `npm run db:migrate`)
    └── repositories/      Query logic, one module per table
        ├── users.ts          Query logic for the users table
        ├── oauthAccounts.ts  Provider identity links
        └── authSessions.ts   Refresh-token records and revocation
```

Each folder carries a `*_CONTEXT.md` explaining the "why" behind its design:
`db/DB_CONTEXT.md`, `api/API_CONTEXT.md`, `agent/AGENT_CONTEXT.md`,
`auth/AUTH_CONTEXT.md`.

### `app.ts` / `server.ts` — composition root

`app.ts` builds the fully-wired Fastify instance without binding a port: CORS
(credentialed, scoped to `ALLOWED_ORIGINS`, explicitly allowing `X-CSRF-Token`),
rate limiting, cookie parsing and the global auth hooks, the WebSocket plugin,
and the route plugins (today: health and auth). Keeping it separate from the
listen bootstrap is what lets `npm test` exercise the guards with `app.inject()`
and no database.

`server.ts` loads `dotenv`, calls `buildApp()`, runs pending migrations **before**
listening, and wires `SIGINT`/`SIGTERM` to close the server and drain the pg
pool. Port defaults to `8000` locally; the container sets `PORT=8080`.

### `auth/` — identity

Owns accounts, credentials and session cookies. A
15-minute access JWT rides in an httpOnly cookie (so the WebSocket upgrade
carries it automatically), backed by opaque, rotating refresh tokens whose
SHA-256 lives in `auth_sessions` for revocation. Google sign-in is OIDC with
PKCE, linked on the provider's stable `sub` claim. See `auth/AUTH_CONTEXT.md`
for the reasoning, including why the cookie domain dictates the deployment shape.

It knows nothing about interpretation either, which is why it came through the
chat removal untouched: it supplies `request.user`, and every domain route and
the push channel take their `user_id` from there.

### `api/` — the HTTP surface

**(today: `auth.ts` and `health.ts`. The rest is planned.)**

Each route file is a `FastifyPluginAsync` covering one domain and owns its zod
request/response schemas. Routes import `db` directly and delegate all queries to
`db/repositories/`; they never build SQL themselves.

Routes that accept natural language call an agent-layer interpretation function,
validate what comes back, and then either commit it or return it as a draft — see
[The interpret flow](#the-interpret-flow).

### `agent/` — the LLM layer

**(planned — the folder holds no code since the chat generator was deleted.)**

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

**Today the schema holds exactly the three auth tables below** — the shipped
Phase 1a model. `sessions` and `messages` went with the chat app (see
[Removing the chat app](#removing-the-chat-app)). The domain tables —
`categories`, `inventory_items`, and the rest — arrive with roadmap Phase 1b, and
the target model for them is specified in [`PRD.md` §6](PRD.md).

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
```

> **Migration note.** Two migrations are destructive, both deliberately.
> `0001_auth_users_oauth.sql` deleted the pre-auth chat sessions — created
> anonymously, with no owner to satisfy the `NOT NULL user_id` it added — and
> `0002_drop_chat.sql` then dropped those tables outright.
>
> `0001` is also hand-written rather than generated: `drizzle/meta/0000_snapshot.json`
> was never committed, so `drizzle-kit generate` diffed against an empty database
> and emitted `CREATE TABLE IF NOT EXISTS "sessions"` — a silent no-op on a live
> database that would never have added the column. Because `0001` committed a
> snapshot describing the real post-state, `0002` and everything after it are
> machine-generated again.

The conventions these tables set, which any new table should follow:

- **App-generated UUIDs.** IDs are minted in the application via
  `crypto.randomUUID` rather than by `gen_random_uuid()`, so no `pgcrypto`
  extension is required and the ID is known before the insert returns.
- **Every user-owned table carries `user_id UUID NOT NULL REFERENCES users(id)
  ON DELETE CASCADE`**, and is indexed on `(user_id, …)` for its common list
  query. Account deletion then cascades without bespoke cleanup.
- **`jsonb` only for genuinely open-ended fields** (item `attributes`, fallback
  decisions, notification payloads) — validated with zod at the boundary. Things
  that get queried or constrained are real columns.
- **Anything the app joins on is a table, not a string.** `category` is the
  worked example ([`PRD.md`](PRD.md) §5.1.1): budgets aggregate spend by it, so
  as free text an interpreter writing `grocery` then `groceries` would silently
  split a budget rather than erroring. `unit` stays free text under the same
  test — nothing joins on it, and drift there never leaves the row.

Schema lives in `db/schema.ts`; the generated SQL lives in `node-server/drizzle/`.
Migrations are versioned files applied by `migrate.ts` on startup — replacing any
"create tables on boot" approach, which can create missing tables but can never
alter existing ones. After editing `schema.ts`, run `npm run db:generate` and
commit the generated SQL; never hand-edit a migration that has already been
applied anywhere.

---

## Runtime flows

**Authentication is shipped; the interpret and push flows are planned.** Neither
of the latter exists in the code yet — with the chat turn loop deleted,
authentication is the only runtime flow the app currently has.

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

This flow is independent of the chat removal. Every flow below assumes it: the
authenticated user id is where `user_id` comes from, always server-side.

### The interpret flow

This is the application's characteristic flow — every natural-language input in
the product runs through it:

```
1. Client POSTs free text:  { "text": "Add 1984 to my Books" }
2. Assemble context:        the user's item names + ids, and for stock updates
                            each named item's quantity / par_level / unit /
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

Two habits from the chat turn loop outlive it and apply here: **never hold a
transaction across a model call** (do the reads in one short transaction, call
Claude with none open, persist in another), and **re-check ownership on every
message rather than only at the handshake** — a socket outlives the 15-minute
access token, and the account may be deleted mid-connection.

### The WebSocket push channel

**(planned.)** One socket per authenticated user, opened after login. The
`@fastify/websocket` plugin is still registered in `app.ts` with no route
attached — the chat socket's route was removed and this channel, running in the
opposite direction, takes its place.

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
| `DATABASE_URL` | — | Required. `postgresql://postgres:postgres@localhost:5432/salaman_db`. |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origin(s), comma-separated. Credentialed CORS means this must name the frontend origin exactly — no wildcards. Also gates mutation `Origin` checks and the WS handshake. |
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
- **No client-side WebSocket reconnect.** The deleted `useWebSocket` hook had no
  `onclose` handling, and the push channel will inherit the gap unless it is
  fixed deliberately when it is written. A dropped socket — Cloud Run timeout,
  scale-down, laptop sleep, flaky network — silently stops live updates until a
  page reload. Closing the gap
  means (1) reconnect with capped exponential backoff, (2) a visible
  "reconnecting" state, and (3) re-fetching the affected views on reconnect,
  since pushes sent while disconnected are simply missed. The push channel's
  best-effort contract keeps this from being data loss, but the UI does go stale
  without telling the user.
- **Prompt caching is unproven at this size.** `cache_control: { type:
  "ephemeral" }` belongs on the interpretation prompts, whose static prefix
  (instructions + JSON schema) should clear the 1024-token minimum comfortably —
  unlike the ~60-token chat prompt it replaced, which never engaged caching at
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
- **Self-managed Postgres on a Compute Engine VM, reached over Direct VPC
  egress** — cheaper than Cloud SQL at this size, at the cost of running the
  database yourself. See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the as-built
  topology and the migration path back to Cloud SQL.
- **One language end to end** — shared types and tooling across backend and
  frontend; ML work would arrive as a separate service.

---

## Roadmap

The forward-looking product direction is specified in full in [`PRD.md`](PRD.md)
and sequenced into phases in [`ROADMAP.md`](ROADMAP.md). In brief:

1. ~~**Accounts, authentication & sessions**~~ — **shipped, described above.**
   Delivered with **Google OAuth in addition to** email + password, which
   overrides PRD §1's password-only lock and §9's "OAuth is a non-goal"; the rest
   of PRD §3 was followed as specified. The per-user push channel is the piece
   still outstanding — it arrives with the first pushed row change in Phase 1b.
2. **Inventory** — items and stock levels classified by user-defined categories
   (a first-class table with its own management page), with natural-language
   input (direct commit) alongside precise CRUD.
3. **Search, mandates, grants & budgets** — NL inventory search, deterministic
   reorder triggers, per-item spend caps, and per-period category budgets.
4. **Carts** — product resolution against a shopping provider, cart review, and
   manual placement. The app never completes a checkout.
5. **Automation** — a reorder scheduler with windows, the LLM fallback decision,
   and notifications.

This file stays focused on the architecture as built, and is updated as each
phase lands.
