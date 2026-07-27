# Agent Context

This is the LLM layer of the backend. It is intentionally isolated from routing and database
concerns — its only job is to talk to Claude and hand back **structured, parsed data**.

> ⚠️ **This describes the target, not `index.ts` as it stands.** Today this folder contains the
> Phase 1 chat streaming generator — a system prompt with an assistant persona and an async
> generator that yields `text_delta` chunks. It is **to be deleted**, not refactored; see
> `docs/ARCHITECTURE.md` → *Removing the chat app*. Everything below is what replaces it.

## The model is an interpreter, not a conversationalist

There is to be no chat in this application. Nothing in this folder should hold a dialogue, stream
tokens, or keep conversation state. Every function here is the same shape:

```
(user text, context) → Claude (single turn, tool use) → structured JSON → caller validates → DTO
```

The user types *"Add 1984 to my Books"*; the interpretation function returns
`{ category: "Books", name: "1984", … }`; the API layer validates it and writes the row. The model's
output is an **input to application logic** — it is never sent to the browser as-is.

If you find yourself adding a `messages` array, a system persona, or a streaming generator here,
stop: that is the chat app being kept alive rather than removed.

## Responsibility

One **interpretation function per target**, each owning:

- **Its prompt** — isolated so it can be tuned without touching any other layer.
- **Its tool / output schema** — the tool's `input_schema` *is* the target schema, so the model is
  forced to return schema-shaped JSON rather than prose that needs regexing out.

Targets (see `docs/PRD.md` §8.1–8.2): inventory item definitions, inventory stock updates, search
queries, mandates/grants, product selection, and the fallback judgment call.

## What this layer must not do

- **No database access.** Context (item names, ids, stock levels, thresholds) is passed in as
  arguments by the caller. This is deliberate: it keeps `user_id` scoping entirely server-side, so a
  model response can name *what* to write but never *whose* row to touch.
- **No writes, no side effects.** Interpretation returns data; the API layer decides whether to
  commit it.
- **No trust in the model's shape.** The caller re-validates every response with the same zod schema
  the route would accept directly. Tool use makes malformed output unlikely, not impossible.

## Validation is the caller's job, and it is not optional

Both commit patterns (`docs/PRD.md` §5.0) depend on it:

- **Direct commit** (inventory) — interpret → validate → write. The zod check is the *only* thing
  between a bad parse and the database.
- **Confirm-before-commit** (mandates, grants) — interpret → validate → show a draft → write on
  approval.

Direct commit removes the human approval step, **not** the schema gate. A failed or low-confidence
interpretation persists nothing under either pattern.

## SDK

The Anthropic TypeScript SDK (`@anthropic-ai/sdk`) handles authentication via `ANTHROPIC_API_KEY`
from the environment, request formatting, and tool use. It is async and non-blocking by
construction, so one process serves concurrent interpretation calls without blocking the event loop.

Calls are **non-streaming**: the response is awaited whole, because it has to be validated before
anything can be done with it. There is no partial-output case to handle.

## Reliability and cost

Each call runs synchronously inside the request that triggered it, so it needs a timeout, one
bounded retry on transient errors, and a clean user-facing failure ("couldn't read that, try
rephrasing") rather than a 500.

**Prompt caching:** set `cache_control: { type: "ephemeral" }` on the static prefix — instructions
plus the JSON schema. Unlike the ~60-token chat prompt this layer replaces (which sits below the
minimum and never engages caching at all), a schema-bearing extraction prompt should clear it
comfortably — but note the minimum is **model-dependent and not monotonic** (1024 tokens on Sonnet
4.6, 4096 on Haiku 4.5), so tiering down to a cheaper model can silently switch caching off. Check `usage.cache_read_input_tokens` is non-zero once the first
extractor ships rather than assuming it.

Log tokens, latency, and model per call — with the model on the hot path of nearly every user
action, cost needs to be measurable rather than a surprise.

## Dependencies and consumers

This folder depends only on the Anthropic SDK — not on the database or API layers.

It is consumed by the route handlers in `../api/`, which assemble context, call an interpretation
function, validate the result, and commit it. See `../api/API_CONTEXT.md`.
