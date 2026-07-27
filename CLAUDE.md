# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Salamander is a shopping agent: it tracks what a user owns and, when stock runs low, assembles a ready-to-checkout cart for the user to place manually. The app never completes a checkout.

**There is no chatbot, and no conversational surface of any kind.** The LLM is an *interpreter*: wherever the app needs structured data, the user types a plain sentence and the model converts it into the DTO the server persists.

```
plain text → LLM interprets → DTO → server validates + commits → WS push → UI updates
```

The user types *"Add 1984 to my Books"*; the model returns `{ category: "Books", name: "1984", … }`; the server validates with zod, writes the row, pushes it over that user's WebSocket, and the UI clears the input and shows the new entry.

Rules that follow from this — treat them as invariants:

- Every LLM call is **single-turn, non-streaming, and stateless**, and returns **structured output** via tool use. No conversation history is assembled or stored.
- **Never return model prose to the user.** A model response is an input to application logic; the server decides what the UI shows.
- **Always validate the model's output** with the same zod schema the route uses. This gate — not any UI confirm step — is what keeps a bad parse out of the database.
- **`user_id` is bound server-side**, never taken from a model response or a request body.
- The **WebSocket is a per-user, server→client push channel** carrying row changes, not tokens. It is best-effort; REST is the source of truth.

Commit policy (direct commit vs. confirm-before-commit) is decided **per module**, not globally — see `docs/PRD.md` §5.0. Settled so far: inventory → direct commit; mandates and grants → confirm-before-commit.

**The chat app that shipped as Phase 1 has NOT been removed yet — it is still what runs.** `sessions` + `messages` tables, `POST /sessions`, `GET /sessions/{id}/history`, the token-streaming handler in `api/websocket.ts`, the chat generator in `agent/index.ts`, and the React chat UI are all still present. Removing them is prerequisite work ahead of roadmap Phase 1; `docs/ARCHITECTURE.md` → *Removing the chat app* has the checklist.

Until that lands, expect the code and these docs to disagree: the docs describe the interpreter architecture, the code is still the chat app. When they conflict, **the docs are the spec and the code is the thing to change** — do not "fix" the docs back toward the chat implementation, and do not extend the chat surface.

## Before Starting Any Work

1. Read `docs/ARCHITECTURE.md` — it is the source of truth for architecture, data model, runtime flows, and deployment. Always check it before making structural decisions. The forward-looking product spec lives in `docs/PRD.md`, and `docs/ROADMAP.md` sequences it into phases.
2. Read all `*_CONTEXT.md` files relevant to the area you are working in. These explain the "why" behind each folder's design without duplicating what the code already says.

Current context files:
- `node-server/src/db/DB_CONTEXT.md` — database, connectivity, migrations, and repository structure
- `node-server/src/api/API_CONTEXT.md` — API layer, routing, and the WebSocket push channel
- `node-server/src/agent/AGENT_CONTEXT.md` — LLM layer: interpretation functions, schemas, prompt caching

`README.md` covers how to run the server, the client, and the full stack locally.

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js 20 + TypeScript + Fastify |
| LLM | Claude API via Anthropic TypeScript SDK (`claude-sonnet-4-6`) |
| Real-time | WebSockets (`@fastify/websocket`) — server→client push only |
| Database | PostgreSQL + Drizzle ORM + `pg` |
| Migrations | `drizzle-kit`, applied on server startup |
| Validation | zod — at the HTTP boundary *and* on every LLM response |
| Local Dev DB | Local PostgreSQL 16 |
| Deployment | Google Cloud Platform, deployed from source with Cloud Buildpacks. `docs/DEPLOYMENT.md` is the as-built runbook (Cloud Run + Postgres on a VM + Firebase Hosting) |

The backend lives in `node-server/`. `py-server/` is the superseded Python/FastAPI implementation, kept for reference until parity is confirmed against the frontend — do not add features there.

## Repository

Remote: https://github.com/ygowthaman/project-salamander.git
