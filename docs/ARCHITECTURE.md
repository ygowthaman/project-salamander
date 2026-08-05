# Salamander — Architecture

Salamander is a household inventory system: it tracks what a home owns, how much
is left, and what has run low, and builds a spending record alongside that
inventory. This document is the source of truth for how the system is built — its
layers, data model, runtime flows, deployment shape, and the decisions behind
them. [`PRD.md`](PRD.md) specifies *what* the product does and why;
[`ROADMAP.md`](ROADMAP.md) sequences the work.

> ### ⚠️ Parts of this document are specification, not code
>
> The schema, authentication and households are built. The inventory service
> layer, the LLM layer and the push channel are specified here and **not yet
> written** — sections describing them are marked **(planned)**, and
> [Known gaps](#known-gaps) lists what is missing in detail.

**What runs today:** authentication (email + password and Google OAuth, enforced
on every route), households with their routes and settings UI, `GET /health`, and
the full domain schema — `households`, `users`, `categories`, `inventory_items`,
`mandates`. The inventory routes exist with their validation
and serialisation wired, but every handler returns 501: the service layer beneath
them is deliberately unwritten, so the seam is marked rather than guessed at.

Two things to understand before touching this codebase:

- **[Ownership](#ownership-a-household-owns-the-data)** — a household owns the
  data; a user owns only their credentials.
- **[The role of the LLM](#the-role-of-the-llm)** — it is an interpreter that may
  ask one bounded clarifying question. It is never an assistant, and there is no
  chat surface anywhere in the product.

---

## The role of the LLM

**The user never converses with a model.** The LLM is an *interpreter* sitting
behind the UI: wherever the app needs structured data, the user types a plain
sentence and the model converts it into the DTO the server persists.

```
plain text → LLM interprets → DTO → server validates + commits → WS push → UI updates
                    │
                    └─ can't resolve? → a question back to the user, up to 10 turns,
                                        then fail to the form. Nothing is written.
```

The user types *"Add 1984 to my books"*; the model returns
`{ name: "1984", category_id: "…", … }` — an id resolved from the **household's**
categories ([`PRD.md`](PRD.md) §2.5.5); the server validates it with zod, writes
the row, and pushes the new record to every member who may see it; the UI clears
the input and the row appears in the table.

**The one bounded exception: the model may ask a clarifying question** (PRD
§2.5.7). *"Library does not exist as a category. Did you mean Books?"* is the
model working out what the user meant, and the exchange runs to a hard cap of
**ten turns** before the operation fails and points the user at the form. The
exchange is **ephemeral** — held in memory, never stored, dead on reload.
Everything else the user reads is rendered by the server from the record: a read
renders rows, a write renders what was stored, and the turn-ten failure message is
server-written.

Four jobs, one shape:

| Job | Input | Output |
|---|---|---|
| **Interpretation** — the dominant case | free text + target schema + metadata | a DTO the server commits, **or a question** |
| **Search interpretation** | free text | a query DTO the server runs (rows never return to the model) |
| **Selection** | provider candidates + a constraint set | which product goes on a line item |
| **Judgment** | a constraint miss + budget headroom | one action from a fixed set |

Architectural consequences, which run through everything below:

- **No durable conversation state** — no messages table, no chat session, no
  history replay. An exchange lives in memory for the length of one
  interpretation and is dropped when it ends, so the backend stays stateless for
  correctness and needs no session affinity.
- **No token streaming** — responses are awaited whole and validated before use.
- **The WebSocket carries data, not tokens** — it is a push channel for row
  changes (see [The push channel](#the-push-channel)).
- **The server, not the model, decides what the user sees.** Model prose is
  confined to clarification; results and failures are rendered from the record.
- **The metadata is the privacy boundary.** What the model is given is what it can
  resolve — and therefore what it can reveal. Another member's private items are
  never sent, including to an admin. This is enforced when context is assembled,
  never by asking the model to keep a secret.

---

## Ownership: a household owns the data

**A household owns the data; a user owns only their credentials.** Every domain
table carries `household_id`, and `users.household_id` — NOT NULL, always present,
auto-provisioned when a user skips the create form — is the only path from a
person to anything they can see.

The reason is that the alternative, letting a user exist without a household,
means every part of the system that reads data has to handle two ownership
shapes. With the guarantee there is exactly **one** shape, and the "single user"
case is just a household with one member in it. Nothing downstream special-cases
it.

Two user columns sit on `inventory_items` anyway, and **neither is ownership**:
`added_by_user_id` is attribution (displaying that name is the whole reason a
soft-deleted user's row survives), and `is_private` is visibility. The rule is not
*"no domain table names a user"* but **"no domain table takes its scope from
one."**

Three consequences worth stating up front, because they recur in every layer:

- **Scope is bound server-side** from the auth session — never from a request
  body, a query string, or a model response.
- **Every read is visibility-filtered**: `NOT is_private OR added_by_user_id = me`.
  An admin gets no privileged view of another member's private items.
- **`users.skip_household` records an answer, not a state.** A user who was asked
  and skipped and a user who was never asked both have a household; the flag is
  what lets the UI tell them apart, and **nothing may surface the household
  concept to a user at `true`** — not UI copy, not LLM metadata, not anything the
  model says back.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript, Mantine + Tabler icons |
| Backend | Node.js 20 + TypeScript + Fastify |
| LLM | Claude API via the Anthropic TypeScript SDK |
| Real-time | WebSockets (`@fastify/websocket`) — server→client push only |
| Auth | Google OAuth 2.0 (OIDC + PKCE) and email + password (argon2id); JWT access cookie via `jose` |
| Database | PostgreSQL 16 + Drizzle ORM over `pg` (node-postgres) |
| Migrations | `drizzle-kit` — generated SQL applied on server startup (rebuilt from scratch each schema edit, for now) |
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

The backend holds **no durable conversational state**. All durable state lives in
Postgres, and every interpretation carries its own metadata assembled from the
database at the start of the exchange. What is held in memory is a socket handle
per user and, for the length of one interpretation, its turns — both disposable,
because every view is re-fetchable over REST and an abandoned exchange leaves the
inventory exactly as it was.

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
├── agent/                 (planned) LLM layer — interpretation functions,
│                          each owning its prompt + tool schema
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
│   ├── households.ts      /households/* — create, members, roles, deletion
│   ├── inventory.ts       /inventory/items/* — zod + serialisers wired;
│   │                      every handler returns 501 pending the service layer
│   ├── categories.ts      (planned) CRUD behind the management page
│   └── websocket.ts       (planned) the push channel
└── db/
    ├── client.ts          pg.Pool + Drizzle instance; Db / DbExecutor types
    ├── schema/            Drizzle tables, one module per domain, barrelled
    │   ├── index.ts         The barrel — both consumers read this list
    │   ├── common.ts        Column helpers (not tables; kept out of the barrel)
    │   ├── households.ts    The ownership root; imports nothing
    │   ├── auth.ts          users / oauth_accounts / auth_sessions
    │   ├── categories.ts    Household-scoped taxonomy
    │   ├── inventory.ts     inventory_items
    │   └── mandates.ts      The reorder opt-in (imports inventory, never the reverse)
    ├── migrate.ts         Startup migration runner (also `npm run db:migrate`)
    ├── reset-migrations.ts  Clears drizzle/ so db:generate writes a fresh baseline
    └── repositories/      Query logic, one module per table
        ├── users.ts          Query logic for the users table
        ├── oauthAccounts.ts  Provider identity links
        ├── authSessions.ts   Refresh-token records and revocation
        └── households.ts     Membership, roles, provisioning and deletion
```

**Module order in `schema/` follows the dependency graph, which is acyclic and
must stay that way:** `households ← auth ← categories ← inventory ← mandates`.
Drizzle's `references(() => x.id)` is lazy, so a cycle would survive at runtime
while TypeScript inference degraded confusingly. Two invariants sit on that order:
`households.ts` imports nothing (it is the root — an owner FK back to `users`
would close a cycle with `users.household_id`), and `inventory.ts` must never
import `mandates.ts`. As separate files, both are greppable rather than merely
written down.

Each folder carries a `*_CONTEXT.md` explaining the "why" behind its design:
`db/DB_CONTEXT.md`, `api/API_CONTEXT.md`, `agent/AGENT_CONTEXT.md`,
`auth/AUTH_CONTEXT.md`.

### `app.ts` / `server.ts` — composition root

`app.ts` builds the fully-wired Fastify instance without binding a port: CORS
(credentialed, scoped to `ALLOWED_ORIGINS`, explicitly allowing `X-CSRF-Token`),
rate limiting, cookie parsing and the global auth hooks, the WebSocket plugin,
and the route plugins. Keeping it separate from the listen bootstrap is what lets
`npm test` exercise the guards with `app.inject()` and no database. **New route
plugins are registered here.**

`server.ts` loads `dotenv`, calls `buildApp()`, runs pending migrations **before**
listening, and wires `SIGINT`/`SIGTERM` to close the server and drain the pg
pool. Port defaults to `8000` locally; the container sets `PORT=8080`.

### `auth/` — identity

Owns accounts, credentials and session cookies. A 15-minute access JWT rides in an
httpOnly cookie (so the WebSocket upgrade carries it automatically), backed by
opaque, rotating refresh tokens whose SHA-256 lives in `auth_sessions` for
revocation. Google sign-in is OIDC with PKCE, linked on the provider's stable
`sub` claim. See `auth/AUTH_CONTEXT.md` for the reasoning, including why the
cookie domain dictates the deployment shape.

It knows nothing about the domain: it supplies `request.user`, and every domain
route and the push channel derive their **`household_id`** from there — never
from a request body, a query string, or a model response.

### `api/` — the HTTP surface

Each route file is a `FastifyPluginAsync` covering one domain and owns its zod
request/response schemas. Routes import `db` directly and delegate all queries to
`db/repositories/`; they never build SQL themselves.

Two rules every domain route enforces at the boundary, before any service call:

- **Scope comes from `request.user`.** The request schemas have no `household_id`
  field, so a caller cannot even send one.
- **Every read is visibility-filtered** — `NOT is_private OR added_by_user_id = me`.
  This belongs in the repository layer, expressed once: repeated at each call
  site it will eventually be forgotten at one of them.

Cross-household access to a known `{id}` is **404, not 403** — a 403 confirms the
row exists.

Routes that accept natural language call an agent-layer interpretation function,
validate what comes back, and then either commit it or return the model's
question — see [The interpretation exchange](#the-interpretation-exchange).

### `agent/` — the LLM layer

**(planned.)**

Intentionally isolated from routing and the database — its only job is to talk to
Claude. It exposes one **interpretation function per target**, each owning:

- **Its prompt** — isolated so it can be tuned without touching any other layer.
- **Its tool/output schema** — the tool's `input_schema` *is* the target schema,
  so the model must return schema-shaped JSON rather than prose to be regexed.

**Object-or-question falls out of tool use.** The model calls the tool when it can
resolve the sentence (`stop_reason: "tool_use"`) and replies with plain text when
it cannot (`end_turn`) — exactly the branch the exchange needs. `tool_choice` is
therefore left at its default: forcing the tool would strip the model's ability to
ask and push it into inventing an id instead.

Callers pass context (the household's categories, the items in the asking
member's view) and get back parsed, schema-shaped data or a question. The agent
layer performs no database access and no writes; it receives the context it needs
as arguments. That is what keeps household scoping and privacy filtering concerns
of the caller, which the model cannot influence — see `agent/AGENT_CONTEXT.md`.

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
interpret-and-commit flow relies on when one sentence names several items and
either all of them land or none do.

---

## Data model

```sql
households                              -- the ownership root; references nothing
  id             UUID PRIMARY KEY
  name           TEXT NOT NULL          -- chosen, or derived from the email local-part
  address        TEXT                   -- optional; a household without one is normal
  created_at, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

users
  id             UUID PRIMARY KEY
  household_id   UUID NOT NULL REFERENCES households(id)   -- always present
  email          TEXT NOT NULL          -- stored lowercased; UNIQUE among active
  password_hash  TEXT                   -- NULL for Google-only accounts
  display_name   TEXT
  avatar_url     TEXT
  email_verified BOOLEAN NOT NULL DEFAULT false
  role           user_role NOT NULL DEFAULT 'user'   -- enum: admin | user
  skip_household BOOLEAN NOT NULL DEFAULT true
  deleted_at     TIMESTAMPTZ            -- soft delete; the record outlives the account
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

categories                              -- household-defined taxonomy
  id, household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE
  name             TEXT NOT NULL
  created_at, updated_at
  UNIQUE (household_id, lower(name))    -- expression index: a second "groceries" is a 409

inventory_items                         -- every tracked thing, in its complete form
  id, household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE
  name             TEXT NOT NULL
  category_id      UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT
  added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL  -- attribution
  is_private       BOOLEAN NOT NULL DEFAULT false                -- visibility
  unit             TEXT                 -- free text, deliberately
  quantity         INTEGER              -- NULL = "tracked, count unknown"
  attributes       JSONB                -- author/edition/isbn, model number
  created_at, last_updated

mandates                                -- the reorder opt-in; NOT the inventory module
  id, household_id, inventory_item_id
  par_level INTEGER NOT NULL, restock_level INTEGER
  trigger_condition JSONB, shopping_query TEXT, preferred_product JSONB
  UNIQUE (inventory_item_id)            -- one rule per item; changing it is an UPDATE
```

Four things in there are easy to get wrong:

- **`added_by_user_id` is `ON DELETE SET NULL`, never CASCADE.** A departing
  housemate must not delete the household's stock. Deleting a user is a soft
  delete precisely so that attribution stays displayable.
- **`category_id` is `ON DELETE RESTRICT`.** Deleting a category with items in it
  is a 409 naming the count, not a delete that silently takes a collection.
- **`inventory_items` carries nothing about reordering.** "Is this reorderable?"
  is answered by the existence of a `mandates` row — one FK the database enforces
  — not by a nullable-column convention every consumer has to remember. A book and
  a carton of eggs are both complete rows.
- **On `mandates`, nullable means "not yet supplied", never "inapplicable".**
  Every row is by definition a reorderable item, so par and restock always apply.

The conventions these tables set, which any new table should follow:

- **App-generated UUIDs.** IDs are minted in the application via
  `crypto.randomUUID` rather than by `gen_random_uuid()`, so no `pgcrypto`
  extension is required and the ID is known before the insert returns.
- **Every domain table carries `household_id UUID NOT NULL REFERENCES
  households(id) ON DELETE CASCADE`**, and is indexed on `(household_id, …)` for
  its common list query. It is denormalised onto child tables (`mandates`) so a
  household's rows are one indexed read rather than a join — and it is always
  copied from the parent row, never read from a request body.
- **A table whose existence encodes an opt-in beats nullable columns that encode
  it by convention.** `mandates` is the worked example. Split when a column is
  *inapplicable* to some rows; do **not** split merely because it is *unset* on
  some rows.
- **`jsonb` only for genuinely open-ended fields** (item `attributes`, fallback
  decisions, notification payloads) — validated with zod at the boundary. Things
  that get queried or constrained are real columns.
- **Anything the app groups by is a table, not a string.** `category` is the
  worked example: statistics and budgets aggregate by it, so as free text an
  interpreter writing `grocery` then `groceries` would silently split a total
  rather than erroring. `unit` stays free text under the same test — nothing
  groups by it, and drift there never leaves the row.

Schema lives in `db/schema/`; the generated SQL lives in `node-server/drizzle/`.
Migrations are files applied by `migrate.ts` on startup — replacing any "create
tables on boot" approach, which can create missing tables but can never alter
existing ones.

**During the current dev cycle the migration chain is rebuilt, not extended.**
`npm run db:generate` deletes `drizzle/` and regenerates a single baseline from
`schema/`; `npm run db:migrate` drops every table and replays it; `npm run
db:reset` runs both, which is the normal response to a schema edit. Nothing is
hand-edited and nothing is caught up, because no database holds data worth
keeping — the moment one does, the chain freezes and diffs get appended again.
See `node-server/src/db/DB_CONTEXT.md` for what that switch involves.

> **Requires `drizzle-kit` >= 0.31.** Older versions load the schema through CJS
> `require`, which cannot resolve the `./auth.js` specifiers NodeNext ESM obliges
> us to write — every cross-file import fails `db:generate` with
> `MODULE_NOT_FOUND`. Do not downgrade without collapsing `schema/` back into a
> single file.

---

## Runtime flows

**Authentication is shipped; the interpretation and push flows are planned.**

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

Either path ends at the same place: a 15-minute access JWT in an httpOnly cookie,
plus an opaque refresh token whose SHA-256 is recorded in `auth_sessions`.
`POST /auth/refresh` **rotates** — it revokes the presented record and issues a
new one — and treats a replayed, already-revoked token as a compromise signal,
revoking every session for that user.

Google identities are linked on the provider's stable `sub`. If the email matches
an existing password account, the two are linked **only when Google asserts the
address is verified**; otherwise the attempt is refused, because auto-linking an
unverified address is an account-takeover path.

```
1. GET /auth/google        → 302 to accounts.google.com   (state + PKCE cookie)
2. user consents           → 302 back to /auth/google/callback?code&state
3. verify state → exchange code → verify ID token (iss + aud)
4. find oauth_accounts by (google, sub)
     hit  → that user
     miss → match on verified email → link, else create user
5. issue access + refresh cookies → 302 to the frontend
```

Every flow below assumes it: the authenticated user is where **`household_id`**
(scope), **`added_by_user_id`** (attribution) and the visibility filter all come
from, always server-side.

### The interpretation exchange

**(planned.)** This is the application's characteristic flow — every
natural-language input in the product runs through it:

```
1. Client POSTs free text:  { "text": "Add 1984 to my library" }
2. Assemble metadata:       the HOUSEHOLD's categories, and the items in THIS
                            MEMBER'S view (NOT is_private OR added_by = me) with
                            names + attributes; per named item quantity + unit,
                            plus par_level LEFT JOINed from mandates where it exists
3. Interpret:               agent-layer call → tool use (an object) OR text (a question)
4a. A question →            return it, increment the turn counter, write nothing.
                            The user answers; loop to step 3 with the exchange appended
4b. An object →             validate with the SAME zod schema the route would
                            accept directly. Invalid → treat as unresolved
5. At turn 10, unresolved:  fail. A SERVER-WRITTEN message points the user at the
                            form. Nothing is written
6. Commit:                  every item row the sentence named, in ONE transaction
7. Push:                    the changed rows, to the members allowed to see them
8. Respond:                 the applied old→new diff, so the UI clears the input
                            and shows what it did
```

Three properties of the loop are load-bearing:

- **It is capped at ten and ephemeral.** In-memory only; a reload ends it. If you
  reach for a table to hold it, you are building a chat app.
- **Nothing partial commits.** One sentence may name several items; if any part
  fails to resolve, the whole sentence re-enters the exchange rather than
  committing the parts that did.
- **The fallback for a failed interpretation is not another interpretation.** It
  is the form — which is why the form path never touches the LLM, and why
  inventory stays fully usable when the model is unavailable.

Once an object validates, it is written immediately: there is no draft and no
approval gate. The clarification loop is the model working out intent, not a step
where the user signs off on a parse. **Validation is not what varies** — a failed
interpretation persists nothing, and the zod check is the only thing between a bad
parse and the database.

Two habits the design depends on: **never hold a transaction across a model call**
(do the reads in one short transaction, call Claude with none open, persist in
another) — which matters more given a call can be one of ten — and **re-check
authorisation on every message rather than only at the handshake**, since a socket
outlives the 15-minute access token and a member can leave the household or be
removed mid-connection.

### The push channel

**(planned.)** One socket per authenticated user, opened after login. The
`@fastify/websocket` plugin is registered in `app.ts` with no route attached, so
standing this up is a route file rather than a dependency decision.

- **Auth happens at the handshake** — the cookie rides along with the WS upgrade.
  Unauthenticated upgrades are rejected. CORS does not apply to the upgrade, so
  the `Origin` check is explicit.
- **The channel is derived server-side** from the authenticated user id. The
  client never names it, so there is no path parameter to forge.
- **The socket is per-user; the fan-out is per-household.** A change publishes to
  every member of the owning household who currently has one open —
  `publish(householdId, event)`, not `publish(userId, event)`. Membership is
  re-checked per push, not cached from the handshake.
- **Visibility filters the push, exactly as it filters the read.** An ordinary
  item reaches every member; a **private** item reaches only `added_by_user_id`.
  This is the third place the same rule applies — reads, LLM metadata, and pushes
  — and it leaks through whichever one is forgotten.
- **Server → client only.** The client sends nothing; every user action is a REST
  call. This is a notification bus, not an RPC transport.
- **Payloads are typed data events**, not text:

```jsonc
{ "type": "inventory.upserted",   "items": [ { "id": "…", "name": "1984", … } ] }
{ "type": "inventory.deleted",    "ids": ["…"] }
{ "type": "category.upserted",    "categories": [ … ] }
{ "type": "notification.created", "notification": { … } }
```

The channel exists because two different things change rows a member is looking
at: their own interpret-and-commit calls, and background work with no request in
flight at all. One delivery path covers both.

**It is an optimization, never the source of truth.** Every view is fetchable over
REST, so a dropped socket degrades the UI to stale-until-refresh rather than
breaking it — which matters given the reconnect gap below and Cloud Run's one-hour
cap on socket lifetime.

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

**The push channel needs non-default Cloud Run flags**, or long-lived sockets
drop:

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
REST fetch — no more.

**The backend must be served from `api.axoliz.ai`, not its `run.app` URL.** This
is an auth constraint, not cosmetics. Auth cookies are `SameSite=Lax`, which means
the browser omits them on **cross-site** requests. `run.app` is on the Public
Suffix List, so `salamander-server-….run.app` and `salamander.axoliz.ai` are
different sites — every authenticated call from the frontend would arrive without
a cookie and 401, while working perfectly on localhost. Mapping the service to
`api.axoliz.ai` puts both sides under the `axoliz.ai` registrable domain, and
`COOKIE_DOMAIN=axoliz.ai` issues one cookie that covers both.

The alternative — `SameSite=None; Secure` — would work on the `run.app` URL today
but is a third-party cookie: already blocked by Safari ITP and Firefox, and on
Chrome's deprecation path. See `DEPLOYMENT.md` §8 for the domain mapping steps.

---

## Known gaps

- **The inventory service layer does not exist.** `api/inventory.ts` holds the zod
  schemas, serialisers and route registrations, but **every handler returns 501**.
  The repositories those routes are meant to delegate to (`categories`,
  `inventoryItems`) do not exist either.
- **The inventory UI renders against a mock.** `InventoryPage` and
  `InventoryItemCard` read `api/mocks/inventory.groupedByCategory.json`, and the
  natural-language box posts to a `/inventory/interpret` that has no server side.
  The client and server also disagree on the route shape — the client calls
  `/inventory?groupBy=category`, the server serves
  `/inventory/items/grouped?group_by=…`.
- **Nothing implements the visibility filter yet.** `NOT is_private OR
  added_by_user_id = me` is a schema comment and a product rule; no query
  enforces it, and the inventory wire shape omits `is_private` and
  `added_by_user_id` entirely, so no client could act on it either. The same
  wire shape has no way to *set* `is_private`, so a private item cannot currently
  be created through the API.
- **The migration has never been applied to a live Postgres.** Doing so is the
  first real test of the migration path and should happen before anything is
  stacked on top of it.
- **Database behaviour has no test lane.** `npm test` covers the guard layer
  (tokens, PKCE, CSRF, Origin, auth gating) and is deliberately database-free, so
  household scoping, the case-insensitive unique index, `ON DELETE RESTRICT` and
  the `SET NULL` attribution path have nowhere to be tested. Signup, login, the
  OAuth callback and refresh rotation are likewise uncovered.
- **No email transport.** `users.email_verified` is set by Google, but a password
  account can never verify, a forgotten password cannot be reset, and household
  invitations to addresses without an account cannot be sent.
- **No client-side WebSocket reconnect.** A dropped socket — Cloud Run timeout,
  scale-down, laptop sleep, flaky network — will silently stop live updates until
  a page reload unless this is built deliberately: (1) reconnect with capped
  exponential backoff, (2) a visible "reconnecting" state, and (3) re-fetching
  the affected views on reconnect, since pushes sent while disconnected are
  simply missed. The channel's best-effort contract keeps this from being data
  loss, but the UI does go stale without telling the user.
- **No frontend router.** `App.tsx` is a binary authenticated/unauthenticated
  gate. Categories, inventory and settings are separate pages, so this needs
  resolving before the inventory UI grows.
- **Prompt caching is unproven at this size.** `cache_control: { type:
  "ephemeral" }` belongs on the interpretation prompts, but the minimum cacheable
  prefix is model-dependent and not monotonic, so tiering down to a cheaper model
  can silently switch caching off. Verify `usage.cache_read_input_tokens` is
  non-zero once the first interpreter ships rather than assuming it.

---

## Key design decisions

- **A household owns the data; a user owns only their credentials** — one
  ownership shape everywhere, with the single-user case as a household of one.
  The alternative makes every reader handle two shapes forever.
- **The LLM is an interpreter, not an assistant** — non-streaming,
  structured-output, and allowed to ask a clarifying question only while it is
  still working out what one sentence meant. The exchange is capped at ten turns
  and held in memory, so there is no conversation state to persist and the backend
  needs no session affinity for correctness.
- **The two input paths are not layered** — the form is a second entrance to the
  same operations, not a fallback surface. It never touches the LLM, which is what
  lets a failed interpretation fail to *something*, and what keeps inventory
  usable when the model is down.
- **Validate every model response with the same zod schema the route uses** — a
  model response is untrusted input. This gate, not a UI confirm step, is what
  guarantees a bad parse never reaches the database.
- **Direct commit, after the exchange resolves** — the clarification loop is the
  model working out intent, not an approval step. There is no draft to sign off.
- **Scope is bound server-side, never taken from the model** — an interpretation
  result names *what* to write, never *whose* row to touch.
- **Privacy is enforced by what is assembled, not by what is asked** — a private
  item that was never put in the context window cannot be leaked out of it. The
  same filter governs reads, LLM metadata and WS pushes; an admin gets no
  privileged view.
- **A table whose existence encodes an opt-in beats nullable columns** — `mandates`
  makes "is this reorderable?" one FK the database enforces rather than a
  convention spread across route, agent and UI code.
- **WebSocket as a best-effort push channel, not a transport** — server→client
  only, REST remains the source of truth, so socket loss degrades freshness rather
  than function.
- **App-generated UUIDs** — no `pgcrypto` dependency, and the ID exists before the
  insert round-trips.
- **Explicit migrations over sync-on-startup** — `drizzle-kit` produces SQL applied
  at boot, which can alter existing tables, not just create missing ones. The chain
  is rebuilt from scratch on each schema edit for now; versioning starts when a
  database first holds data worth keeping.
- **Auth cookies over bearer tokens** — httpOnly removes the XSS token-theft
  class, and the cookie rides the WebSocket upgrade automatically (a browser
  cannot set headers on `new WebSocket()`). The cost is that the API must share a
  registrable domain with the frontend.
- **OAuth linked on the provider's `sub`, never email** — a Google account's email
  can change; `sub` cannot. Linking to an existing password account requires
  Google to assert the email is verified, or it is an account-takeover path.
- **Opaque, rotating refresh tokens with replay detection** — revocation becomes a
  row update rather than a JWT blocklist, and a replayed token revokes the user's
  whole session family.
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

## What's next

Specified in [`PRD.md`](PRD.md) and sequenced in [`ROADMAP.md`](ROADMAP.md); the
inventory build is tracked in `docs/context/INVENTORY_CONTEXT.md`. In brief:

1. **The inventory service layer** — behind the routes that already exist, with
   the visibility filter expressed once in the repository layer.
2. **Categories management** — the CRUD page the inventory picker reads from.
3. **The push channel** — per-user socket, per-household fan-out, and a frontend
   client that reconnects.
4. **The interpretation exchange** — the natural-language path for add, read,
   update, delete and stock, with the ten-turn clarification loop.
5. **Bill capture, budgeting and statistics** — the remaining product
   capabilities.
6. **Reorder** — mandates beyond their levels, plus the constraint and scheduling
   layers that hang off them.
