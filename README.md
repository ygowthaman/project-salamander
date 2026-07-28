# Salamander

A shopping agent. It tracks what you own and, when stock runs low, assembles a
ready-to-checkout cart for you to place. The app never completes a checkout.

**By design, there is no chatbot.** The LLM is an *interpreter*: wherever the app
needs structured data, you type a plain sentence and the model turns it into the
record the server stores.

```
"Add 1984 to my Books"  →  { name: "1984", category_id: "…", … }  →  saved  →  pushed to the UI
```

Every model call is single-turn, non-streaming, and returns structured output —
never prose shown to a user. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the architecture, [`docs/PRD.md`](docs/PRD.md) for the product spec, and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what ships when.

> **Current state: the Phase 1 chat app is still what runs.** The interpreter
> model above is the *target*, not the code. What exists today is a streaming chat
> assistant — `sessions` + `messages` tables, `POST /sessions`, and a
> token-streaming WebSocket — on a foundation of Fastify, Postgres/Drizzle with
> startup migrations, and the Anthropic SDK. **Removing that chat surface is the
> next work**, ahead of the rest of roadmap Phase 1 (inventory). See
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) → *Removing the chat app*.
>
> **Accounts are real, though** — sign in with Google or with email + password, JWT
> session cookies with CSRF, auth enforced on every route and at the WebSocket
> handshake. That is roadmap Phase 1a, and it stays when the chat surface goes.

| Piece | Stack | Local URL |
|---|---|---|
| `frontend/` | React + Vite + TypeScript | http://localhost:5173 |
| `node-server/` | Node 20 + TypeScript + Fastify + Drizzle | http://localhost:8000 |
| PostgreSQL 16 | installed natively | localhost:5432 |
| `py-server/` | Legacy Python/FastAPI backend — superseded, kept for reference | — |

---

## Prerequisites

- **Node.js 20+** — the server runs on 18, but `drizzle-kit` (used to generate
  migrations) requires 20
- **PostgreSQL 16** — installed locally (below)
- **An Anthropic API key** — https://console.anthropic.com

---

## Run the whole application

Three terminals, in this order.

### 1. Database

One-time setup on Ubuntu/Debian:

```bash
sudo apt install -y postgresql
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres psql -c "CREATE DATABASE shopping;"
```

macOS: `brew install postgresql@16 && brew services start postgresql@16`, then
create the `shopping` database and set the `postgres` password to match.

The service starts on boot, so this is a one-time step. Check it's up:

```bash
pg_isready -h localhost -p 5432        # → localhost:5432 - accepting connections
```

This gives you PostgreSQL 16 on `localhost:5432` with user `postgres`,
password `postgres`, database `shopping` — matching the `DATABASE_URL` in
`.env.example` with no edits.

### 2. Backend

```bash
cd node-server
cp .env.example .env      # then edit .env and paste your real API key
npm install
npm run dev
```

Serves on **http://localhost:8000** with hot reload (`tsx watch`). On boot it applies
any pending migrations from `drizzle/`, creating the `users`, `oauth_accounts`,
`auth_sessions`, `sessions` and `messages` tables on the first run.

> **The auth migration deletes pre-auth chat data.** `0001_auth_users_oauth.sql`
> drops every row in `sessions` (and their messages, via the cascade) because
> anonymous conversations have no owner to satisfy the new `NOT NULL user_id`.
> First run on an existing database wipes that history.

**Google sign-in is optional locally.** Leave `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` blank and the server still runs with email + password;
`/auth/google` returns 503 and the "Continue with Google" button fails until they
are set. To enable it, create a Web application OAuth client with the redirect URI
`http://localhost:8000/auth/google/callback` (see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §9).

Verify:

```bash
# Unauthenticated — expect 401 plus a Set-Cookie minting the CSRF token.
curl -i http://localhost:8000/auth/me
# HTTP/1.1 401 Unauthorized
# set-cookie: sal_csrf=...
```

`POST /sessions` now requires a session cookie *and* an `X-CSRF-Token` header
matching the `sal_csrf` cookie, so it is easiest to exercise through the app
rather than curl. Run the guard-layer checks with:

```bash
npm test        # tokens, PKCE, CSRF, Origin, auth gating — needs no database
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open **http://localhost:5173**.

> **The frontend `.env` is not optional.** `VITE_WS_URL` falls back to a LAN
> address from a previous dev machine, so leaving it unset gives you working REST
> calls and a chat that silently never connects.

---

## Environment variables

### `node-server/.env`

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Read automatically by the Anthropic SDK |
| `DATABASE_URL` | — | Required. `postgresql://postgres:postgres@localhost:5432/shopping` |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origin(s), comma-separated. Credentialed CORS — must name the origin exactly, no wildcards |
| `PORT` | `8000` | Cloud Run sets this automatically in production |
| `HOST` | `0.0.0.0` | |
| `JWT_SECRET` | dev fallback | Signs access-token JWTs and the OAuth state cookie. Min 32 chars; **required in production** — `openssl rand -base64 32` |
| `PUBLIC_API_URL` | `http://localhost:8000` | Public origin of this server; Google redirects to `${PUBLIC_API_URL}/auth/google/callback`, which must match the OAuth client exactly |
| `FRONTEND_URL` | `http://localhost:5173` | Where the browser lands after an OAuth round-trip |
| `COOKIE_DOMAIN` | *(empty)* | Leave empty locally. In production, the shared registrable domain so one cookie covers the app and API hosts |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(empty)* | Optional — blank means email + password only, with `/auth/google` returning 503 |

`DATABASE_URL` takes a plain `postgresql://` scheme. The old
`postgresql+asyncpg://` form was SQLAlchemy-specific; the server strips the suffix
if it finds one, but new config should not include it.

### `frontend/.env`

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | REST base URL |
| `VITE_WS_URL` | `ws://192.168.1.103:8000` | **Set this** — the default is a stale LAN IP |

Both are read at build time by Vite. Restart `npm run dev` after changing them.

---

## API

### Auth (built, and staying)

`POST /auth/signup` · `POST /auth/login` · `GET /auth/google` ·
`GET /auth/google/callback` · `POST /auth/refresh` · `POST /auth/logout` ·
`GET /auth/me` · `PATCH /auth/me` · `POST /auth/change-password` ·
`DELETE /auth/me`.

Access token in an httpOnly cookie, refresh with rotation and server-side
revocation, double-submit CSRF token on every mutating request, `Origin` checked
at the WebSocket handshake. Signup and login are rate-limited. The design
reasoning is in
[`node-server/src/auth/AUTH_CONTEXT.md`](node-server/src/auth/AUTH_CONTEXT.md).

### Today (chat app — to be removed)

**`POST /sessions`** — create a chat session.

```jsonc
// request  — title optional, defaults to "New Session"
{ "title": "Laptop hunt" }
// response 200
{ "id": "<uuid>", "title": "Laptop hunt", "created_at": "<ISO 8601>" }
```

**`GET /sessions/{session_id}/history`** — messages oldest first; `404` if the
session does not exist.

**`WS /ws/{session_id}`** — one frame per user turn:

```jsonc
// client → server
{ "message": "I need a laptop under $800" }
// server → client
{ "type": "chunk", "text": "..." }   // one per streamed chunk
{ "type": "done" }                    // end of the assistant turn
{ "type": "error", "message": "Session not found" }
```

### Replacing it

All three endpoints go away with the chat app
([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) → *Removing the chat app*), along
with the `sessions`/`messages` tables. A `GET /health` gets added in the same
change so the service stays verifiable while it has no other routes.

The routes that replace them — inventory, categories, and the per-user WebSocket
push channel — are specified in [`docs/PRD.md`](docs/PRD.md) §7 and sequenced in
[`docs/ROADMAP.md`](docs/ROADMAP.md). The auth routes above are already there and
are unaffected by the removal.

Two conventions those routes will follow, worth knowing before you add one:

- **Natural-language input goes to a route, not a socket.** A text input POSTs to
  a REST endpoint that interprets, validates with zod, and commits (or returns a
  draft — the choice is per module, see PRD §5.0).
- **The WebSocket is server→client only.** It carries typed data events
  (`inventory.upserted`, `cart.updated`, …) so the UI can update live. It is
  best-effort; REST remains the source of truth.

---

## Common tasks

```bash
# Backend
cd node-server
npm run dev          # hot-reloading dev server on :8000
npm run typecheck    # tsc --noEmit
npm run build        # compile to dist/
npm start            # run the compiled build
npm run db:migrate   # apply migrations without starting the server
npm run db:generate  # regenerate drizzle/ after editing src/db/schema.ts

# Frontend
cd frontend
npm run dev
npm run build        # tsc -b && vite build → dist/
npm run preview      # serve the production build locally
npm run lint

# Database
psql -h localhost -U postgres -d shopping     # password: postgres
sudo systemctl status postgresql
sudo -u postgres psql -c "DROP DATABASE shopping;"   # nuke and re-run migrations
```

---

## Deployment

[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) is the as-built runbook — Cloud Run for
the backend, PostgreSQL on a Compute Engine VM reached over Direct VPC egress, and
Firebase Hosting for the frontend. Two things matter enough to repeat here.

**Deploys build from source — no Docker.** Cloud Run builds the image from the
source tree with Cloud Buildpacks; there is no Dockerfile to maintain and no local
Docker to install. The only CLI you need is `gcloud`:

```bash
gcloud run deploy salamander-server --source .
```

**Long-lived WebSockets need non-default Cloud Run flags** — today's chat socket
and the push channel that replaces it both:

```bash
gcloud run deploy salamander-server --source . \
  --session-affinity \    # keep a user's requests on one instance
  --timeout=3600          # max socket lifetime; the 300s default drops idle sockets
```

Session affinity is best-effort — a scale-down still cuts live sockets, and the
frontend has no reconnect logic (see `docs/ARCHITECTURE.md` → *Known gaps*). That
matters less once the push channel lands: because it is an optimization rather
than the source of truth, a dropped socket will leave the UI stale until the next
fetch rather than broken. On today's chat socket, a drop loses the response
mid-sentence.

---

## Troubleshooting

**Chat UI loads but messages never send.** `VITE_WS_URL` is unset, so the socket
points at the stale default LAN IP. Set it in `frontend/.env` and restart Vite.

**Chat dies after a few minutes idling in a deployed environment.** Cloud Run's
request timeout is capping the WebSocket. See [Deployment](#deployment).

**Backend exits with `DATABASE_URL is not set`.** You skipped
`cp .env.example .env`, or you're running from the repo root instead of
`node-server/`.

**`ECONNREFUSED 127.0.0.1:5432` on boot.** Postgres isn't running — start it with
`sudo systemctl start postgresql`.

**`password authentication failed for user "postgres"`.** A fresh `apt` install
uses peer auth with no password set — run the
`ALTER USER postgres PASSWORD 'postgres';` line from step 1.

**`401` from the Anthropic API.** `ANTHROPIC_API_KEY` is missing or still the
placeholder from `.env.example`. REST calls keep working; only the streamed turn
fails.

**`npm install` warns `EBADENGINE ... required: node >=20`.** That's
`drizzle-kit`, a dev-only dependency. The server itself runs on 18; you only need
Node 20 to regenerate migrations.

---

## Repo layout

```
project-salamander/
├── node-server/    backend — see src/{db,api,agent}/*_CONTEXT.md for design notes
├── frontend/       React SPA (chat UI today; to be replaced)
├── py-server/      legacy Python backend, superseded by node-server
└── docs/
    ├── ARCHITECTURE.md   architecture, data model, runtime flows, deployment
    ├── PRD.md            product spec for the shopping agent
    ├── ROADMAP.md        phased delivery plan
    └── DEPLOYMENT.md     as-built GCP runbook
```
