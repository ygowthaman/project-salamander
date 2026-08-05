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

> **Current state: accounts, and not much else yet.** Sign in with Google or with
> email + password — JWT session cookies with CSRF, auth enforced on every route
> (roadmap Phase 1a) — on a foundation of Fastify, Postgres/Drizzle with startup
> migrations. The interpreter model above is the *target*, and inventory is the
> next thing to land.

| Piece | Stack | Local URL |
|---|---|---|
| `frontend/` | React + Vite + TypeScript | http://localhost:5173 |
| `node-server/` | Node 20 + TypeScript + Fastify + Drizzle | http://localhost:8000 |
| PostgreSQL 16 | installed natively | localhost:5432 |

---

## Prerequisites

- **Node.js 20+** — the server runs on 18, but `drizzle-kit` (used to generate
  migrations) requires 20
- **PostgreSQL 16** — installed locally (below)
- **An Anthropic API key** — https://console.anthropic.com. Not needed to run
  what exists today; the interpretation layer will want it.

---

## Run the whole application

Three terminals, in this order.

### 1. Database

One-time setup on Ubuntu/Debian:

```bash
sudo apt install -y postgresql
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
sudo -u postgres psql -c "CREATE DATABASE salaman_db;"
```

macOS: `brew install postgresql@16 && brew services start postgresql@16`, then
create the `salaman_db` database and set the `postgres` password to match.

The service starts on boot, so this is a one-time step. Check it's up:

```bash
pg_isready -h localhost -p 5432        # → localhost:5432 - accepting connections
```

This gives you PostgreSQL 16 on `localhost:5432` with user `postgres`,
password `postgres`, database `salaman_db` — matching the `DATABASE_URL` in
`.env.example` with no edits.

### 2. Backend

```bash
cd node-server
cp .env.example .env      # defaults work locally; no API key needed yet
npm install
npm run dev
```

Serves on **http://localhost:8000** with hot reload (`tsx watch`). On boot it applies
any pending migrations from `drizzle/`, creating the `users`, `oauth_accounts`
and `auth_sessions` tables on the first run.

> **One migration is destructive, and only on an old database.**
> `0001_drop_legacy_chat_tables.sql` drops the `sessions` and `messages` tables
> left behind by the retired Python backend. Nothing in this schema creates them,
> so on a database provisioned from this migration chain it does nothing.

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

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

Every other route requires a session cookie *and* an `X-CSRF-Token` header
matching the `sal_csrf` cookie, so they are easiest to exercise through the app
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

You get the login screen, and a placeholder shell once signed in — the inventory
UI is the next thing to land there.

> `VITE_WS_URL` is currently unused: the per-user push channel has not been built
> yet. Set it correctly anyway, or the first thing that opens a socket will
> inherit a stale default.

---

## Environment variables

### `node-server/.env`

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Unused until the interpretation layer lands; read automatically by the Anthropic SDK when it does |
| `DATABASE_URL` | — | Required. `postgresql://postgres:postgres@localhost:5432/salaman_db` |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origin(s), comma-separated. Credentialed CORS — must name the origin exactly, no wildcards |
| `PORT` | `8000` | Cloud Run sets this automatically in production |
| `HOST` | `0.0.0.0` | |
| `JWT_SECRET` | dev fallback | Signs access-token JWTs and the OAuth state cookie. Min 32 chars; **required in production** — `openssl rand -base64 32` |
| `PUBLIC_API_URL` | `http://localhost:8000` | Public origin of this server; Google redirects to `${PUBLIC_API_URL}/auth/google/callback`, which must match the OAuth client exactly |
| `FRONTEND_URL` | `http://localhost:5173` | Where the browser lands after an OAuth round-trip |
| `COOKIE_DOMAIN` | *(empty)* | Leave empty locally. In production, the shared registrable domain so one cookie covers the app and API hosts |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(empty)* | Optional — blank means email + password only, with `/auth/google` returning 503 |

`DATABASE_URL` takes a plain `postgresql://` scheme, with no dialect suffix.

### `frontend/.env`

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | REST base URL |
| `VITE_WS_URL` | `ws://192.168.1.103:8000` | Unused until the push channel lands. Set it anyway — the default is a stale LAN IP |

Both are read at build time by Vite. Restart `npm run dev` after changing them.

---

## API

### Today

`POST /auth/signup` · `POST /auth/login` · `GET /auth/google` ·
`GET /auth/google/callback` · `POST /auth/refresh` · `POST /auth/logout` ·
`GET /auth/me` · `PATCH /auth/me` · `POST /auth/change-password` ·
`DELETE /auth/me`.

Access token in an httpOnly cookie, refresh with rotation and server-side
revocation, double-submit CSRF token on every mutating request, `Origin` checked
at the WebSocket handshake (once a socket exists again). Signup and login are
rate-limited. The design reasoning is in
[`node-server/src/auth/AUTH_CONTEXT.md`](node-server/src/auth/AUTH_CONTEXT.md).

**`GET /health`** — `{ "status": "ok" }`. Unauthenticated and database-free: it
reports that the process is serving, not that Postgres is reachable.

That is the whole surface.

### Next

The routes that fill the gap — categories, inventory, and the per-user WebSocket
push channel — are specified in [`docs/PRD.md`](docs/PRD.md) §7 and sequenced in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

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
npm run db:reset     # DEV: rebuild drizzle/ from schema/, then rebuild the database
npm run db:generate  # wipe drizzle/ and regenerate one baseline from src/db/schema/
npm run db:migrate   # DEV: drop every table, then replay that baseline
npm run db:migrate:preserve  # apply pending migrations without dropping anything

# Frontend
cd frontend
npm run dev
npm run build        # tsc -b && vite build → dist/
npm run preview      # serve the production build locally
npm run lint

# Database
psql -h localhost -U postgres -d salaman_db     # password: postgres
sudo systemctl status postgresql
sudo -u postgres psql -c "DROP DATABASE salaman_db;"   # rarely needed — db:reset already wipes
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

**Long-lived WebSockets will need non-default Cloud Run flags** — nothing opens
a socket today, but the push channel will:

```bash
gcloud run deploy salamander-server --source . \
  --session-affinity \    # keep a user's requests on one instance
  --timeout=3600          # max socket lifetime; the 300s default drops idle sockets
```

Session affinity is best-effort — a scale-down still cuts live sockets, and the
frontend has no reconnect logic (see `docs/ARCHITECTURE.md` → *Known gaps*). That
matters less than it looks: because the channel is an optimization rather than
the source of truth, a dropped socket leaves the UI stale until the next fetch
rather than losing anything.

---

## Troubleshooting

**Signed in, but the app looks empty.** That is the current state — the inventory
UI has not landed. `GET /health` and the `/auth/*` routes are the whole backend
surface.

**Backend exits with `DATABASE_URL is not set`.** You skipped
`cp .env.example .env`, or you're running from the repo root instead of
`node-server/`.

**`ECONNREFUSED 127.0.0.1:5432` on boot.** Postgres isn't running — start it with
`sudo systemctl start postgresql`.

**`password authentication failed for user "postgres"`.** A fresh `apt` install
uses peer auth with no password set — run the
`ALTER USER postgres PASSWORD 'postgres';` line from step 1.

**`npm install` warns `EBADENGINE ... required: node >=20`.** That's
`drizzle-kit`, a dev-only dependency. The server itself runs on 18; you only need
Node 20 to regenerate migrations.

---

## Repo layout

```
project-salamander/
├── node-server/    backend — see src/{db,api,agent}/*_CONTEXT.md for design notes
├── frontend/       React SPA (login + a placeholder signed-in shell)
└── docs/
    ├── ARCHITECTURE.md   architecture, data model, runtime flows, deployment
    ├── PRD.md            product spec for the shopping agent
    ├── ROADMAP.md        phased delivery plan
    └── DEPLOYMENT.md     as-built GCP runbook
```
