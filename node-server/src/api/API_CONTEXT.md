# API Context

This folder contains the Fastify route handlers. Each file is a `FastifyPluginAsync` covering one domain, registered by `server.ts`.

## Structure

- **sessions.ts** — REST endpoints for session creation and message history. Also owns the zod request/response schemas for both sessions and messages, since no other layer needs them. Zod replaces what Pydantic did in the Python implementation: parse the input, and shape the output explicitly.

- **websocket.ts** — WebSocket endpoint (`/ws/:session_id`). Handles the real-time message loop: loads history, saves messages, streams tokens from the agent layer back to the client.

## DB session scoping

The WebSocket connection is long-lived, but each incoming message needs its own transaction — one held open for the socket's lifetime would pin a pooled connection for as long as the user keeps the tab open, and would leave a transaction open across the entire LLM stream.

So each turn opens two short transactions: one for *look up session → load history → save the user message*, and one for *save the assistant message* after the stream completes. The LLM call happens between them, with no transaction open. This is the same per-message scoping the Python version used with `AsyncSessionFactory`, expressed as `db.transaction(...)` instead.

## Ordering

Socket `message` events can fire while a previous turn is still streaming. The handler chains them through a promise queue so turns are processed strictly in order — otherwise two concurrent turns would interleave their `chunk` frames and race on writing history.

## Session-not-found stays connected

If the session lookup fails, the handler sends `{ type: "error", message: "Session not found" }` and keeps the socket open, waiting for the next message. It does not close the connection. The frontend's `useWebSocket` hook has no reconnect logic, so closing here would leave the UI permanently dead until a page reload.

## Disconnect mid-stream

`send()` is a no-op when the socket is no longer open, so if the client vanishes mid-turn the stream still drains and the assistant message is still persisted. The Python version behaved differently — `send_text` on a closed socket raised, which aborted the turn before the assistant message was saved.

The new behaviour is the intentional one: the turn was already paid for, so discarding it helps nobody, and the completed message being in the database is what lets a reconnecting client recover it. The consequence is that a client which reconnects **must** re-fetch `GET /sessions/{id}/history` — otherwise it will be missing a turn that exists server-side. See `docs/ARCHITECTURE.md` → *Known gaps*.

## Dependencies

Both files import `db` directly from `db/client.ts` and delegate all queries to `db/repositories/`. Neither builds SQL itself.

`websocket.ts` also depends on `agent/index.ts` for LLM streaming — it is the only file in this folder that touches the agent layer.

## Adding a new endpoint

Create a new file exporting a `FastifyPluginAsync`, then register it in `server.ts` with `app.register(...)`.
