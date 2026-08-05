# Agent Context

This is the LLM layer of the backend. It is intentionally isolated from routing and database
concerns — its only job is to talk to Claude and hand back **structured, parsed data** (or a
question to put back to the user).

> **The folder is empty of code right now.** Everything below specifies what gets written here,
> starting with the inventory interpreter (`PRD.md` §2.5.5–§2.5.7).

## The model is an interpreter, not an assistant

There is no chat in this application. Nothing here holds an open-ended dialogue, streams tokens, or
keeps durable conversation state. The user is not talking *to* a model — they are stating what they
want done, and the model's job is to turn that into the object the server commits.

```
(user text, exchange so far, metadata) → Claude (tool use) → structured object | question
                                       → caller validates → DTO | question to the user
```

The user types *"Add 1984 to my books"*; the interpreter returns
`{ name: "1984", category_id: "…", … }`; the API layer validates it and writes the row.

**The interpreter may ask a question, and that is the one thing that reaches the user as model
prose.** *"Library does not exist as a category. Did you mean Books?"* is the model working out what
the user meant, and it is allowed (PRD §2.5.7). What is **not** allowed is the model composing
results: a read renders rows, a write renders what was stored, and both are rendered by the server
from the record. The failure message at turn ten, and any instruction about where in the UI to do
something, are **server-written** — never asked of the model.

## A `messages` array is now required — but a chat surface still is not

The old rule here was *"if you find yourself adding a `messages` array, stop."* That rule
over-fired: it conflated two different things, and PRD §2.5.7 needs one of them.

| Allowed | Still forbidden |
|---|---|
| A `messages` array carrying **one interpretation** across up to ten turns | A conversation that outlives the operation it is resolving |
| Turn state held **in memory**, dropped on disconnect | A `messages` table, a session row, history replay |
| Model prose as a **clarifying question** | Model prose as an answer, a result, or a summary |
| An assistant persona? No — there is none | A persona, a personality, a name |
| Non-streaming, awaited whole | Token streaming |

The exchange is **capped at ten and ephemeral** (PRD §2.5.7): it is not stored, not resumable, and
does not survive a reload. If you are reaching for a table to hold it, you are building a chat app
— the cap and the ephemerality are what keep this an interpretation step rather than a chat.

## The shape of a call

**One interpretation function per target.** Each owns:

- **Its prompt** — isolated so it can be tuned without touching any other layer.
- **Its tool / output schema** — the tool's `input_schema` *is* the target schema, so the model is
  forced to return schema-shaped JSON rather than prose that needs regexing out.

**Object-or-question falls straight out of tool use, and that is why it is the right mechanism.**
The model calls the tool when it can resolve the sentence, and replies with plain text when it
cannot:

| Response | `stop_reason` | Caller does |
|---|---|---|
| Tool call | `tool_use` | Validate `input` with zod; commit or reject |
| Text | `end_turn` | Return it as the clarifying question; increment the turn counter; write nothing |

**Never set `tool_choice` to `any` or force a specific tool.** Forcing the tool removes the model's
ability to ask, which is precisely the behaviour §2.5.7 requires — it would be made to invent a
`category_id` rather than say it cannot find one. Leave `tool_choice` at its default.

Targets (PRD §2.5.8): **add**, **read**, **update**, **delete**, and **stock update**. Whether these
are one function that classifies intent or one per target is open — see `INVENTORY_CONTEXT.md` §5.2.

## What the model may not do

Three prohibitions, each with a reason in the PRD (§2.5.7):

- **Item names are resolved, never invented.** If *1984* matches nothing the household tracks, that
  is a question or a plain "nothing tracked" — never a new row conjured to satisfy the sentence.
- **Categories are resolved, never created.** The exchange explains the category is missing and the
  user is directed to where to add one. **There is no `new_category` field** — the DTO carries a
  `category_id` that came from the metadata, or the model asks. *(This inverts the pre-2026-08-05
  rule; see `INVENTORY_CONTEXT.md` D6. Creating metadata from inside the exchange is deferred, not
  refused on principle.)*
- **Nothing partial commits.** One sentence may name several items; if any part fails to resolve,
  the whole sentence goes back into the exchange rather than committing the parts that did.

The id-resolution rule is the same for both: anything the app groups by is a table, and the model
returns its id, never a free-typed string. Budgets and statistics aggregate by category, so a string
here would let `grocery` and `groceries` silently split a total. `unit` fails that test — nothing
groups by it — so it stays free text.

## What this layer must not do

- **No database access.** Context — the household's categories, the items in view, quantities,
  units, `par_level` — is passed in as arguments by the caller.
- **No writes, no side effects.** Interpretation returns data; the API layer decides whether to
  commit it.
- **No scope of its own.** `household_id` and `added_by_user_id` are bound by the caller from the
  auth session. A model response names *what* to write, never *whose* row to touch. This is why the
  layer takes context as arguments rather than fetching it: there is no query here that could be
  built from a model-supplied id.
- **No trust in the model's shape.** The caller re-validates every response with the same zod schema
  the route would accept directly. Tool use makes malformed output unlikely, not impossible.

## Privacy is enforced in the context you are handed

The metadata decides what the model can resolve, so it is also what decides what the model can
reveal. Two rules bind the **caller** assembling it (PRD §2.5.6), and this layer is built assuming
they were honoured:

- **Another member's private items are never in the metadata** — including when the asker is an
  admin (PRD §2.2.9, §2.3.1). A private item that was never sent cannot be named back to the wrong
  person. Do **not** attempt this in the prompt: an instruction to keep a secret is not a privacy
  boundary, and anything in the context window is reachable.
- **Nothing may mention the household to a member at `skip_household = true`** (PRD §2.2.3) — not
  the metadata, and not anything the model says back. A clarifying question about *"your household's
  categories"* is exactly where such a user would learn they have one.

## Validation is the caller's job, and it is not optional

Inventory commits directly once the exchange resolves: `interpret → validate → persist → WS push`.
There is no draft and no approval gate — the clarification exchange is the model working out what
the user meant, not a step where the user signs off on a parse.

Direct commit removes the *human approval* step, **not** the schema gate. The zod check is the only
thing between a bad parse and the database, so a failed or unresolved interpretation persists
nothing.

## SDK

The Anthropic TypeScript SDK (`@anthropic-ai/sdk`) handles authentication via `ANTHROPIC_API_KEY`
from the environment, request formatting, and tool use. It is async and non-blocking by
construction, so one process serves concurrent interpretation calls without blocking the event loop.

Calls are **non-streaming**: the response is awaited whole, because it has to be validated before
anything can be done with it. There is no partial-output case to handle.

Use the SDK's typed exceptions (`Anthropic.RateLimitError`, `Anthropic.APIError`, …) rather than
string-matching error messages, and use its types (`Anthropic.MessageParam`, `Anthropic.Tool`,
`Anthropic.ToolUseBlock`) rather than redeclaring equivalents.

## Reliability and cost

Each call runs synchronously inside the request that triggered it, so it needs a timeout, one
bounded retry on transient errors, and a clean user-facing failure ("couldn't read that, try
rephrasing") rather than a 500.

**An exchange is up to ten calls, not one.** That is the headline cost change from the old one-shot
design, and it makes two things matter more than they used to:

**Prompt caching — lay the request out so the exchange reuses its own prefix.** Caching is a prefix
match and the render order is `tools` → `system` → `messages`, so:

```
tools    ── tool schema ─────────────┐  identical for every household, every user
system   ── instructions ────────────┤  ← cache_control here: shared across ALL callers
messages ── [0] assembled metadata ──┤  ← cache_control here: reused by turns 2..10
            [1..] the exchange turns ─┘  volatile; appended each turn
```

Two breakpoints, both earning their keep: the first is read by every request the service makes, the
second turns turns 2–10 of an exchange into cache reads instead of ten full re-sends of the
household's item list. Put nothing volatile ahead of either — no timestamps, no request ids, and
sort anything serialized so the bytes are stable.

The minimum cacheable prefix is **model-dependent and not monotonic** (1024 tokens on Sonnet 4.6,
4096 on Haiku 4.5, 512 on Opus 5), so tiering down to a cheaper model can silently switch caching
off. **Verify `usage.cache_read_input_tokens` is non-zero** once the first interpreter ships rather
than assuming it.

**Log tokens, latency and model per call — and per exchange.** Per-call is what you tune the prompt
against; per-exchange is what the operation actually cost, and it is the number that tells you
whether the ten-turn cap is being approached in practice or is purely theoretical.

## Dependencies and consumers

This folder depends only on the Anthropic SDK — not on the database or API layers.

It is consumed by the route handlers in `../api/`, which assemble context, call an interpretation
function, validate the result, and either commit it or return the model's question. See
`../api/API_CONTEXT.md`.
