# API Context

This folder contains the Fastify route handlers. Each file is a `FastifyPluginAsync` covering one
domain, registered by `server.ts`.

## Structure

Domain route files (auth, inventory, mandates, …) plus the WebSocket push channel. Each route file
owns its zod request/response schemas, since no other layer needs them — zod parses the input and
shapes the output explicitly.

> ⚠️ **This describes the target surface.** Today this folder contains `sessions.ts` (the chat REST
> routes) and `websocket.ts` (the token-streaming chat socket). Both are **to be deleted** — see
> `docs/ARCHITECTURE.md` → *Removing the chat app*. There is to be no chat route and no streaming
> endpoint; the sections below describe what replaces them.

## The interpret flow

Routes that accept natural language all follow one shape:

```
1. Parse the request body with zod        { text: "Add 1984 to my Books" }
2. Assemble context from the DB           the user's item names + ids, stock levels, thresholds
3. Call an agent-layer interpretation fn  → structured JSON
4. Validate it with the SAME zod schema   invalid / low-confidence → 422, nothing written
5. Commit, or return a draft              per module (below)
6. Push the change on the user's channel
7. Respond with what happened             so the UI can clear the input and show the result
```

Steps 1–4 are identical everywhere. **Step 5 is the only thing that varies**, and it is a per-module
decision (`docs/PRD.md` §5.0):

- **Direct commit** — inventory. One round trip: write, push, respond with the applied diff.
- **Confirm-before-commit** — mandates and grants. Two round trips: a `/parse` route returns a
  validated draft and persists nothing; a second request commits the user-approved object.

Because both share steps 1–4, switching a module later means adding or removing a `/parse` route and
a UI step — not rewriting its interpreter.

**Not every module is an interpreted surface.** `categories.ts` is plain CRUD backing a management
page — no LLM, no `/parse`, no commit-pattern choice to make (`docs/PRD.md` §5.1.1), the same as
account creation and budgets. Two behaviours there are load-bearing rather than incidental: names
are unique per user **case-insensitively** (a duplicate is a 409, not a second row), and `DELETE`
returns a **409 with the item count** when items still reference the category — the FK is
`ON DELETE RESTRICT`, so a cascade can never quietly take a user's collection with it.

**Validation is not the variable part.** A failed interpretation writes nothing under either
pattern; direct commit drops the human approval step, not the schema check.

## Ownership scoping

`user_id` comes from the authenticated session (`request.user`), never from the request body and
never from a model response. Every repository call is scoped by it. A request for another user's
resource returns **404, not 403** — don't confirm that the row exists.

An interpretation result names *what* to write; the server decides *whose* row it lands on.

## Transaction scoping

Keep transactions short and never hold one across an LLM call — that would pin a pooled connection
for the duration of a network round trip to Anthropic. Assemble context, close the read, make the
call, then open a transaction for the write.

A single interpret-and-commit does its write inside one transaction so the row change and its
`inventory_events` audit row land together. Repositories take a `DbExecutor`, so the same function
works inside or outside a transaction — see `../db/DB_CONTEXT.md`.

## The WebSocket push channel

One socket per authenticated user, running in the opposite direction from the chat socket it
replaces. It reuses the `@fastify/websocket` plugin already registered in `server.ts` — only the
route changes:

- **Authenticate at the handshake** — the cookie rides along with the WS upgrade. Reject
  unauthenticated upgrades with a close code. Validate `Origin` too: a cross-site page must not be
  able to open an authenticated socket.
- **The channel is derived server-side** from the authenticated user id. The client never names it,
  so there is no path parameter to forge and no per-message ownership check to get wrong.
- **Server → client only.** The client sends nothing; every user action is a REST call. This is a
  notification bus, not an RPC transport.
- **Typed data events**, not text — `inventory.upserted`, `inventory.deleted`, `category.upserted`,
  `category.deleted`, `cart.updated`,
  `notification.created`.

It exists because two different things change rows the user is looking at: their own
interpret-and-commit calls, and background reorder runs with no request in flight at all. One
delivery path covers both.

**Treat it as best-effort.** Every view is fetchable over REST, so a dropped socket leaves the UI
stale until the next fetch rather than broken. Never make a write's correctness depend on a push
being delivered — the frontend has no reconnect logic yet, and Cloud Run caps socket lifetime at an
hour regardless.

## Dependencies

Route files import `db` directly from `db/client.ts` and delegate all queries to `db/repositories/`.
None builds SQL itself.

Routes that interpret natural language also depend on `agent/` — that dependency runs one way, and
the agent layer never reaches back into the database.

## Adding a new endpoint

Create a new file exporting a `FastifyPluginAsync`, then register it in `server.ts` with
`app.register(...)`. If it takes natural-language input, follow the interpret flow above and state
its commit pattern in the PRD section for that module.
