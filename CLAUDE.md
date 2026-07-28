# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Salamander is a shopping agent — a chat web app where users describe what they want to buy and Claude returns streaming shopping suggestions. Phase 1 established the core foundation of LLM connectivity, real-time streaming, and session persistence. Authentication has since been added: Google OAuth **and** email + password, with every chat session owned by a user. No external search APIs and no payments yet.

## Before Starting Any Work

1. Read `docs/ARCHITECTURE.md` — it is the source of truth for architecture, data model, runtime flows, and deployment. Always check it before making structural decisions. The forward-looking product roadmap lives in `docs/PRD.md`.
2. Read all `*_CONTEXT.md` files relevant to the area you are working in. These explain the "why" behind each folder's design without duplicating what the code already says.

Current context files:
- `node-server/src/db/DB_CONTEXT.md` — database, connectivity, migrations, and repository structure
- `node-server/src/api/API_CONTEXT.md` — API layer, routing, and WebSocket design
- `node-server/src/agent/AGENT_CONTEXT.md` — LLM layer, streaming, and prompt caching
- `node-server/src/auth/AUTH_CONTEXT.md` — accounts, Google OAuth, cookies/CSRF, and why the cookie domain matters

`README.md` covers how to run the server, the client, and the full stack locally.

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js 20 + TypeScript + Fastify |
| LLM | Claude API via Anthropic TypeScript SDK (`claude-sonnet-4-6`) |
| Real-time | WebSockets (`@fastify/websocket`) |
| Database | PostgreSQL + Drizzle ORM + `pg` |
| Migrations | `drizzle-kit`, applied on server startup |
| Validation | zod |
| Local Dev DB | Local PostgreSQL 16 |
| Deployment | Google Cloud Platform (Cloud Run + Cloud SQL), deployed from source with Cloud Buildpacks |

The backend lives in `node-server/`. `py-server/` is the superseded Python/FastAPI implementation, kept for reference until parity is confirmed against the frontend — do not add features there.

## Repository

Remote: https://github.com/ygowthaman/project-salamander.git
