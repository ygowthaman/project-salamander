# Salamander

A shopping agent. It tracks what your household owns and, when stock runs low,
assembles a ready-to-checkout cart for you to place. The app never completes a
checkout itself.

**By design, there is no chatbot.** The LLM is an *interpreter*: wherever the app
needs structured data, you type a plain sentence and the model turns it into the
record the server stores.

```
"Add 1984 to my Books"  →  { name: "1984", category_id: "…", … }  →  saved  →  pushed to the UI
```

Read next:

- [`docs/PRD.md`](docs/PRD.md) — what the product does and why.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it is built, and what is
  not built yet.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — the as-built GCP runbook.

> **Current state: accounts, and not much else.** Sign in with Google or with
> email + password, on a foundation of Fastify, Postgres and Drizzle. Inventory
> is the next thing to land; the interpreter above is still the target rather
> than the present tense.

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

Serves on **http://localhost:8000** with hot reload (`tsx watch`). On boot it
applies any pending migrations from `drizzle/`.

**Google sign-in is optional locally.** Leave `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` blank and the server still runs with email + password;
`/auth/google` returns 503 and the "Continue with Google" button fails until they
are set. To enable it, create a Web application OAuth client with the redirect URI
`http://localhost:8000/auth/google/callback` (see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) §9).

Verify it is serving:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

```bash
npm test        # guard-layer checks: tokens, PKCE, CSRF, Origin, auth gating — needs no database
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open **http://localhost:5173**. You get the login screen, and a placeholder shell
once signed in.

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

## Troubleshooting

**Signed in, but the app looks empty.** That is the current state — the inventory
UI has not landed.

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
├── node-server/    backend — Fastify, Drizzle, Postgres
├── frontend/       React SPA
└── docs/
    ├── PRD.md            product spec
    ├── ARCHITECTURE.md   how it is built
    └── DEPLOYMENT.md     as-built GCP runbook
```
