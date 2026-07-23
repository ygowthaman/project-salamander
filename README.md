# Salamander

A shopping agent — a chat web app where you describe what you want to buy and Claude
streams back suggestions in real time.

This is Phase 1: LLM connectivity, WebSocket streaming, and session persistence. No
auth, no external search APIs, no payments. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for architecture, data model, and
deployment, and [`docs/PRD.md`](docs/PRD.md) for the product roadmap.

| Piece | Stack | Local URL |
|---|---|---|
| `frontend/` | React + Vite + TypeScript + Tailwind | http://localhost:5173 |
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
any pending migrations from `drizzle/`, so the `sessions` and `messages` tables are
created automatically on the first run.

Verify:

```bash
curl -X POST http://localhost:8000/sessions \
  -H 'Content-Type: application/json' -d '{}'
# {"id":"...","title":"New Session","created_at":"2026-07-22T..."}
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open **http://localhost:5173**.

> **The frontend `.env` is not optional.** `useWebSocket.ts` falls back to
> `ws://192.168.1.103:8000` — a LAN address from a previous dev machine — so without
> `VITE_WS_URL` set, REST calls succeed but the chat silently never connects.

---

## Environment variables

### `node-server/.env`

| Variable | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Read automatically by the Anthropic SDK |
| `DATABASE_URL` | — | Required. `postgresql://postgres:postgres@localhost:5432/shopping` |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origin(s), comma-separated |
| `PORT` | `8000` | Cloud Run sets this automatically in production |
| `HOST` | `0.0.0.0` | |

`DATABASE_URL` takes a plain `postgresql://` scheme. The old
`postgresql+asyncpg://` form was SQLAlchemy-specific; the server strips the suffix if
it finds one, but new config should not include it.

### `frontend/.env`

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | REST base URL |
| `VITE_WS_URL` | `ws://192.168.1.103:8000` | **Set this** — the default is a stale LAN IP |

Both are read at build time by Vite. Restart `npm run dev` after changing them.

---

## API

**`POST /sessions`** — create a session.

```jsonc
// request
{ "title": "Laptop hunt" }   // title optional; defaults to "New Session"
// response 200
{ "id": "<uuid>", "title": "Laptop hunt", "created_at": "<ISO 8601>" }
```

**`GET /sessions/{session_id}/history`** — messages for a session, oldest first.
Returns `404` if the session does not exist.

```jsonc
[{ "id": "<uuid>", "role": "user", "content": "...", "created_at": "<ISO 8601>" }]
```

**`WS /ws/{session_id}`** — one frame per user turn:

```jsonc
// client → server
{ "message": "I need a laptop under $800" }

// server → client
{ "type": "chunk", "text": "..." }   // one per streamed chunk
{ "type": "done" }                    // end of the assistant turn
{ "type": "error", "message": "Session not found" }
```

The connection is long-lived and stays open across turns — including after an
`error` frame.

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

Target is Cloud Run + Cloud SQL. `docs/ARCHITECTURE.md` has the full picture; two
things matter enough to repeat here.

**Deploys build from source — no Docker.** Cloud Run builds the image from the
source tree with Cloud Buildpacks; there is no Dockerfile to maintain and no local
Docker to install. The only CLI you need is `gcloud`:

```bash
gcloud run deploy salamander-server --source .
```

**WebSockets need two non-default Cloud Run flags on the backend service:**

```bash
gcloud run deploy salamander-server --source . \
  --session-affinity \    # keep a session's requests on one instance
  --timeout=3600          # max socket lifetime; the 300s default drops idle chats
```

Without `--timeout`, a user who reads for five minutes before replying gets
disconnected. Session affinity is best-effort — a scale-down still cuts live
sockets, and the frontend currently has no reconnect logic (see
`docs/ARCHITECTURE.md` → *Known gaps*).

---

## Troubleshooting

**Chat UI loads but messages never send.** `VITE_WS_URL` is unset, so the socket is
pointed at the stale default LAN IP. Set it in `frontend/.env` and restart Vite.

**Backend exits with `DATABASE_URL is not set`.** You skipped
`cp .env.example .env`, or you're running from the repo root instead of
`node-server/`.

**`ECONNREFUSED 127.0.0.1:5432` on boot.** Postgres isn't running — start it with
`sudo systemctl start postgresql`.

**`password authentication failed for user "postgres"`.** A fresh `apt` install uses
peer auth with no password set — run the `ALTER USER postgres PASSWORD 'postgres';`
line from step 1.

**Chat dies after a few minutes of idling in a deployed environment.** Cloud Run's
request timeout is capping the WebSocket. See [Deployment](#deployment).

**`401` from the Anthropic API.** `ANTHROPIC_API_KEY` is missing or still the
placeholder from `.env.example`. REST calls will keep working; only the WebSocket
turn fails.

**`npm install` warns `EBADENGINE ... required: node >=20`.** That's `drizzle-kit`, a
dev-only dependency. The server itself runs on 18; you only need Node 20 to
regenerate migrations.

---

## Repo layout

```
project-salamander/
├── node-server/    backend — see src/{db,api,agent}/*_CONTEXT.md for design notes
├── frontend/       React chat UI
├── py-server/      legacy Python backend, superseded by node-server
└── docs/
    ├── ARCHITECTURE.md   architecture, data model, runtime flows, deployment
    └── PRD.md            forward-looking product roadmap
```
