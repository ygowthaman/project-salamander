# API Context

This folder contains the FastAPI route handlers. Each file maps to a domain and registers its own `APIRouter`, which `main.py` mounts.

## Structure

- **sessions.py** — REST endpoints for session management and message history. Also owns the Pydantic request/response schemas for both sessions and messages, since no other layer needs them.

- **websocket.py** — WebSocket endpoint (`/ws/{session_id}`). Handles the real-time message loop: loads history, saves messages, streams tokens from `agent.py` back to the client. Uses `AsyncSessionFactory` directly rather than `Depends(get_db)` since the connection is long-lived and requires a fresh DB session scoped to each message, not the connection.

## Dependencies

REST routes receive a DB session via `Depends(get_db)` from `db/engine.py`. The WebSocket handler manages its own DB sessions via `AsyncSessionFactory`. Both delegate all DB operations to `db/repositories/` and do not query the database directly.

`websocket.py` also depends on `agent.py` for LLM streaming — it is the only file in this folder that touches the agent layer.

## Adding a new endpoint

Create a new file in this folder, define an `APIRouter`, and register it in `main.py` with `app.include_router(...)`.
