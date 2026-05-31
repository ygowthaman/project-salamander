# DB Context

This folder handles all database connectivity and query logic for the Salamander backend.

## Database

PostgreSQL, accessed via SQLAlchemy's async driver (`asyncpg`). In local dev it runs as a Docker container. In production it is Cloud SQL (GCP), connected via the Cloud SQL Auth Proxy sidecar on Cloud Run.

## Dependencies

`engine.py` is the single dependency point for the rest of the backend. It exposes a `get_db` async generator that FastAPI consumes via `Depends(get_db)` — injecting a scoped `AsyncSession` into each route or WebSocket handler. The repositories receive that session as a parameter; they have no direct dependency on `engine.py` themselves.

## Files

- **engine.py** — async engine and session factory. Consumed by `main.py` as a FastAPI dependency. Everything in this folder depends on it indirectly.

- **repositories/sessions.py** — query logic for the `sessions` table. Maps to `models/session.py`.

- **repositories/messages.py** — query logic for the `messages` table. Maps to `models/message.py`.
