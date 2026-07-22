# PRD: Rewrite Backend from Python/FastAPI to Node.js/TypeScript

## Status

Not started. This document is self-contained so a fresh Claude Code session can pick up the
implementation without re-reading this conversation. Read this file first, then `PLAN.md` and
the three `*_CONTEXT.md` files (`py-server/db/DB_CONTEXT.md`, `py-server/api/API_CONTEXT.md`,
`py-server/AGENT_CONTEXT.md`) for the design rationale behind the current Python implementation —
those files describe *why* the current code is shaped the way it is, and that reasoning mostly
carries over even though the language is changing.

## Background & Decision

Salamander's backend is currently Python/FastAPI (Phase 1, per `PLAN.md`). The maintainer's core
skillset is TS/JS, and Anthropic ships a first-party TypeScript SDK with full streaming and
prompt-caching support — there is no capability gap that requires Python. Decision: **rewrite the
entire backend to Node.js/TypeScript**, single language end-to-end (frontend is already
React/TS/Vite). If a genuine ML workload shows up in a future phase, it gets added then as a
separate Python pipeline/service — not built preemptively now.

This is a **like-for-like rewrite, not a redesign**. The goal is to reproduce the existing REST
API, WebSocket protocol, and DB schema exactly, so the frontend (`frontend/`) requires **zero code
changes** — only possibly different local env var values (ports/URLs), not different code.

## Goals

- Replace `py-server/` (Python/FastAPI/SQLAlchemy) with a Node.js/TypeScript backend that is
  functionally identical from the frontend's point of view.
- Preserve module boundaries the Python code already established (db engine/repositories, api
  routes, agent/LLM layer) — they're sound, just need a TS equivalent.
- Fix two known gaps in the current Python implementation along the way (see "Bugs to fix" below).
- Update `PLAN.md`, `CLAUDE.md`, and the three `*_CONTEXT.md` files to reflect the new stack.

## Non-goals

- No new features, no schema changes, no auth, no external search APIs — same Phase 1 scope as
  `PLAN.md` already defines.
- No frontend changes beyond env var values if needed.
- No decision yet about a future Python ML pipeline — out of scope for this task.

---

## Current System Inventory (contracts to preserve exactly)

### REST API (`py-server/api/sessions.py`)

**`POST /sessions`**
- Request body: `{ "title"?: string | null }`
- Behavior: creates a session row with `title = body.title || "New Session"`.
- Response `200`: `{ "id": "<uuid>", "title": "<string>", "created_at": "<ISO 8601 timestamp>" }`

**`GET /sessions/{session_id}/history`**
- Path param: `session_id` (UUID)
- Response `200`: array of `{ "id": "<uuid>", "role": "user"|"assistant", "content": "<string>", "created_at": "<ISO 8601 timestamp>" }`, ordered by `created_at` ascending.
- Response `404` if session doesn't exist (frontend only checks `res.ok` and throws a generic
  `Error`, so the exact error body shape is not load-bearing — just preserve the 404 status).

**CORS**: `allow_origins = [ALLOWED_ORIGINS env var, default "http://localhost:5173"]`,
credentials allowed, all methods/headers allowed.

### WebSocket protocol (`py-server/api/websocket.py`)

Endpoint: **`/ws/{session_id}`**

Client → Server message (one per user turn):
```json
{ "message": "<user's text>" }
```

Server → Client messages:
```json
{ "type": "chunk", "text": "<piece of streamed assistant text>" }   // one per stream chunk
{ "type": "done" }                                                    // end of assistant turn
{ "type": "error", "message": "Session not found" }                   // session lookup failed
```

Per-message server flow (this repeats for every message on a long-lived connection):
1. Look up the session by `session_id`. If missing, send the `error` message and **keep the
   connection open**, waiting for the next client message (does not close/disconnect).
2. Load the full prior message history for the session, ordered by `created_at` ascending.
3. Persist the incoming user message (`role="user"`).
4. Build the LLM messages array: `[...history, { role: "user", content: userMessage }]`, each
   entry shaped as `{ role, content }`.
5. Stream the LLM response (see Agent contract below); for each text chunk, immediately forward
   `{ "type": "chunk", "text": chunk }` to the client and accumulate into `full_response`.
6. After the stream completes, persist the assistant message (`role="assistant"`,
   `content=full_response`).
7. Send `{ "type": "done" }`.

On WebSocket disconnect: exit cleanly, no special handling needed.

Note why the DB session is looked up fresh on every message rather than once at connect time
(per `API_CONTEXT.md`): the WS connection is long-lived, but each message needs its own scoped DB
session/transaction. Preserve this per-message-scoped-session pattern in the Node rewrite (e.g., a
fresh pool client/transaction per incoming message, not one held for the whole socket lifetime).

### Agent / LLM layer (`py-server/agent.py`)

```
SYSTEM_PROMPT = "You are a helpful shopping assistant. When a user describes what they want to buy, \
ask clarifying questions if needed, then provide specific product suggestions with reasoning. \
Include estimated price ranges, key features to look for, and trade-offs between options. \
Be concise and practical."

model: "claude-sonnet-4-6"
max_tokens: 1024
system: SYSTEM_PROMPT
messages: [...]
```
Streams token-by-token via the Anthropic SDK's streaming interface; the agent layer has no DB or
API dependencies and is only consumed by the WebSocket handler.

**Bugs to fix during the rewrite** (both flagged in `AGENT_CONTEXT.md` as known gaps in the
current Python code, not new scope creep):
1. **Prompt caching is not actually implemented.** `PLAN.md` and `AGENT_CONTEXT.md` both call for
   prompt caching on the system prompt "from day one," but the current code passes
   `system=SYSTEM_PROMPT` as a plain string with no `cache_control`. In the Node/TS SDK, implement
   this properly as a content-block array with `cache_control: { type: "ephemeral" }` on the
   system block.
2. **Sync client blocking the event loop.** The Python version uses the sync `Anthropic()` client
   inside an async function, which blocks under concurrent load — `AGENT_CONTEXT.md` calls out
   migrating to `AsyncAnthropic()` as the correct fix. This problem doesn't exist in Node: the
   JS/TS SDK's streaming is async/non-blocking by construction, so just use it normally — no
   special handling needed, but worth noting as "resolved by the platform switch" in the updated
   `AGENT_CONTEXT.md`.

### DB schema (`py-server/models/*.py`)

```sql
sessions
  id          UUID PRIMARY KEY   -- currently app-generated via Python's uuid.uuid4() as the
                                  -- column default, NOT a DB-side gen_random_uuid() default
                                  -- (PLAN.md's sketch says gen_random_uuid(), actual code differs —
                                  -- pick either approach in the rewrite, just be consistent)
  title       TEXT NOT NULL
  created_at  TIMESTAMPTZ DEFAULT now()

messages
  id          UUID PRIMARY KEY   -- same app-generated-default note as above
  session_id  UUID REFERENCES sessions(id) ON DELETE CASCADE
  role        TEXT NOT NULL      -- 'user' | 'assistant'
  content     TEXT NOT NULL
  created_at  TIMESTAMPTZ DEFAULT now()
```

Table creation: current Python does `Base.metadata.create_all` on app startup (in `main.py`'s
`lifespan`), which is not a real migration system. Recommend switching to explicit migrations
(e.g., `drizzle-kit generate` + a migrate step run on startup or as a deploy step) as a small
improvement, since `create_all` was never migration-safe. Flagging as an open decision, not a hard
requirement.

### Repositories (`py-server/db/repositories/*.py`)

Two files, each with two functions — this shape should map over directly:
- `sessions.py`: `create_session(db, title) -> Session`, `get_session(db, session_id) -> Session | None`
- `messages.py`: `save_message(db, session_id, role, content) -> Message`, `get_history(db, session_id) -> Message[]`

### Env vars

| Var | Current value/behavior | Node rewrite notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | read automatically by the Anthropic SDK | same, SDK reads it from env automatically |
| `DATABASE_URL` | `postgresql+asyncpg://postgres:postgres@localhost:5432/shopping` (SQLAlchemy-specific `+asyncpg` dialect suffix) | Node/`pg`/Drizzle expects a plain `postgresql://...` URL — **the `+asyncpg` suffix must be dropped**, update local `.env` instructions accordingly |
| `ALLOWED_ORIGINS` | CORS origin, default `http://localhost:5173` | same |
| `PORT` | Dockerfile hardcodes `--port 8080`; local dev via `uvicorn --reload` defaults to `8000` | keep the same dual convention: local dev server should default to `8000` (matches the frontend's fallback `VITE_API_URL`/`VITE_WS_URL` defaults below), container should listen on `process.env.PORT || 8080` |

Frontend env vars (unchanged, must keep working — `frontend/src/api/sessions.ts` and
`frontend/src/hooks/useWebSocket.ts`):
- `VITE_API_URL` (default `http://localhost:8000`)
- `VITE_WS_URL` (default `ws://192.168.1.103:8000` — a LAN IP specific to a prior dev machine,
  not meaningful to reproduce, just needs to remain overridable)

No `.env`/`.env.example` file currently exists in the repo (`.env` is gitignored); document the
required vars in the new backend's README or a checked-in `.env.example`.

---

## Target Architecture

### Stack (recommended defaults — confirm/adjust at implementation time)

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 20 LTS | current LTS |
| Language | TypeScript | matches frontend, type-safe |
| HTTP + WS framework | Fastify (+ `@fastify/websocket` or standalone `ws`) | native async, lighter than Express, good TS support |
| DB access | Drizzle ORM + `pg` (node-postgres) | TS-native schema/query builder, closest philosophical match to SQLAlchemy Core, good migration story via `drizzle-kit` |
| LLM SDK | `@anthropic-ai/sdk` | first-party, full streaming + prompt caching support |
| Validation | `zod` | replaces Pydantic request/response schemas |
| Dev server | `tsx watch` or `ts-node-dev` | hot reload, mirrors `uvicorn --reload` |

Alternatives considered and rejected for now: Express (Fastify is a better default for a
WS-centric app), Prisma (heavier codegen step; Drizzle is lighter and closer to raw SQL, but
either is acceptable — not a hard blocker).

### Proposed file mapping

| Python (current) | Node/TS (proposed) |
|---|---|
| `py-server/main.py` | `py-server/src/server.ts` — app bootstrap, CORS, route/plugin registration, startup migration |
| `py-server/agent.py` | `py-server/src/agent/index.ts` — system prompt + streaming generator |
| `py-server/db/engine.py` | `py-server/src/db/client.ts` — Drizzle client / pg pool |
| `py-server/db/repositories/sessions.py` | `py-server/src/db/repositories/sessions.ts` |
| `py-server/db/repositories/messages.py` | `py-server/src/db/repositories/messages.ts` |
| `py-server/models/session.py`, `message.py`, `base.py` | `py-server/src/db/schema.ts` — Drizzle table definitions for both tables |
| `py-server/api/sessions.py` | `py-server/src/api/sessions.ts` — REST routes + zod schemas |
| `py-server/api/websocket.py` | `py-server/src/api/websocket.ts` — WS handler |
| `py-server/requirements.txt` | `py-server/package.json` |
| `py-server/Dockerfile` (python:3.12-slim base) | `py-server/Dockerfile` (node:20-slim base) |
| `docker-compose.yml` | unchanged — it only runs Postgres, no code-language dependency |

### Migration approach

Build the new Node backend either in place or in a temporary sibling directory, validate it
against the **unmodified frontend** (both REST and WS contracts above), then delete the Python
files (`py-server/*.py`, `requirements.txt`, Python `Dockerfile` contents) once parity is confirmed.
Keep the old Python code available for reference until the cutover is verified — don't delete
it preemptively.

### Docs to update as part of this task

- `PLAN.md` — tech stack table, project structure tree, local dev commands (`pip install` /
  `uvicorn` → `npm install` / `npm run dev`), `.env` example.
- `CLAUDE.md` — tech stack table (`Python + FastAPI` → `Node.js + TypeScript + <framework>`).
- `py-server/db/DB_CONTEXT.md` — rewrite for Drizzle/pg instead of SQLAlchemy/asyncpg.
- `py-server/api/API_CONTEXT.md` — rewrite for Fastify instead of FastAPI; the core WS-scoping
  rationale (per-message DB session) still applies and should carry over.
- `py-server/AGENT_CONTEXT.md` — rewrite for `@anthropic-ai/sdk`; note the sync/async issue is
  moot in Node, and that prompt caching is now actually implemented (see "Bugs to fix" above).

---

## Acceptance Criteria

- [ ] `POST /sessions` and `GET /sessions/{id}/history` return byte-for-byte-equivalent JSON
      shapes to the current Python implementation.
- [ ] WebSocket `/ws/{session_id}` produces the same `chunk` / `done` / `error` message sequence,
      including the "stay connected on session-not-found" behavior.
- [ ] The **unmodified** frontend (`frontend/`) works end-to-end against the new backend with only
      env var value changes, no code changes.
- [ ] `sessions` and `messages` tables match the schema above; history round-trips correctly.
- [ ] System prompt is sent with `cache_control: { type: "ephemeral" }` (fixes gap #1 above).
- [ ] CORS behavior matches (`ALLOWED_ORIGINS` env var, default `http://localhost:5173`).
- [ ] New Dockerfile builds and runs the container listening on `process.env.PORT || 8080`.
- [ ] `PLAN.md`, `CLAUDE.md`, and the three `*_CONTEXT.md` files are updated to describe the new
      stack accurately.

## Open Decisions (confirm at the start of the implementation session)

1. Fastify vs. another framework (Express, Hono) — Fastify recommended above.
2. Drizzle vs. Prisma vs. raw `pg` — Drizzle recommended above.
3. UUID generation: DB-side (`gen_random_uuid()`, needs Postgres 13+ built-in or `pgcrypto`) vs.
   app-side (`crypto.randomUUID()`). Either is fine; pick one and be consistent — current Python
   code does the latter.
4. Explicit migrations (`drizzle-kit`) vs. a `create_all`-equivalent sync-on-startup. Migrations
   recommended as a small improvement, not a hard requirement.
5. Whether to build the new backend in place under `py-server/` or in a temporary directory before
   cutover — either is fine, just don't delete the Python implementation until parity is verified.
