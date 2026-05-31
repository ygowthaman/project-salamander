# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Salamander is a shopping agent — a chat web app where users describe what they want to buy and Claude returns streaming shopping suggestions. This is Phase 1: establishing the core foundation of LLM connectivity, real-time streaming, and session persistence. No auth, no external search APIs, no payments in Phase 1.

## Before Starting Any Work

1. Read `Plan.md` — it is the source of truth for architecture, build order, data model, and future phases. Always check it before making structural decisions.
2. Read all `*_CONTEXT.md` files relevant to the area you are working in. These explain the "why" behind each folder's design without duplicating what the code already says.

Current context files:
- `backend/db/DB_CONTEXT.md` — database, connectivity, and repository structure
- `backend/api/API_CONTEXT.md` — API layer, routing, and WebSocket design

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| Backend | Python + FastAPI |
| LLM | Claude API via Anthropic Python SDK (`claude-sonnet-4-6`) |
| Real-time | WebSockets (FastAPI native) |
| Database | PostgreSQL + SQLAlchemy (async) |
| Local Dev DB | Docker Compose |
| Deployment | Google Cloud Platform (Cloud Run + Cloud SQL) |

## Repository

Remote: https://github.com/ygowthaman/project-salamander.git
