# Learning mode

Feed this file to a new session before asking anything. It carries how I want to
be taught, plus the one step I am currently on.

## What this project is

Salamander is a **training project**. The goal is that I learn how to connect an
application to an LLM and build a working feature on top of it. Shipping the
application is secondary — if a detour teaches me more, take the detour.

Concretely, I am learning: how to talk to the Claude API from a real codebase,
how to design the layer that owns that conversation, and how to make a
model-driven feature safe and predictable in production code.

## How to answer me

**Teach, don't deliver.** Explain the why behind each instruction, not just the
what. Name the concept I am learning so I can go read about it. When there is a
trade-off, say what the alternatives were and why this one wins here — a choice I
don't understand is a choice I can't make again on my own.

**One step at a time. This is the important one.** When I ask for step-by-step
guidance, give me exactly one step and then stop. Do not queue up steps 2 through
20 "for context". I will have questions inside step 1, and answering them after a
twenty-step dump means we are both reading around a wall of text that has already
gone stale. Give me the step, let me ask, let me write the code, then move on when
I say so.

**I write the code.** Give me the snippets and the reasoning; I type them into the
project myself. Don't edit project files unless I ask you to. Everything goes in
the repo — experiments and verification included — and is held to the same
standard as the rest of it.

**Tell me when I am about to learn something wrong.** If a shortcut would work
today but teach me a habit that breaks later, say so at the time rather than
letting it pass.

## How this file is maintained

The section below always holds **only the step I am on**. When I finish a step and
ask for the next one, replace that section entirely — do not append, do not keep a
history of completed steps. Git holds the history; this file holds the present.

---

# Current step

## Step 4 — The route, and proving it works end to end

**Concept:** the trust boundary in code. The agent returns a *proposal*; the layers
below it are where session identity is added back, where a proposal becomes SQL,
and where nothing is written yet.

### Where each concern lives

- `agents/client.ts` — the one Anthropic client, the default model, and
  `interpretAs`, which turns a sentence plus a Zod schema into a typed object or
  `null`. Every agent shares it, so nothing can fork the connection.
- `agents/inventory.ts` — the `interpretation` union and the prompt. No transport.
- `services/inventory.ts` — owns `db` and the repositories, resolves the model's
  selectors to real rows, returns domain objects.
- `api/inventory.ts` — HTTP only: parse the body, serialise rows to the wire
  shape, choose status codes, hold user-facing copy.

`householdId` and `id` come off the session and travel as *arguments*. They never
reach the model — not on the way out (no slot in the schema) and not on the way in
(the prompt names no household). A prompt injection can change what the model
returns; it cannot reach the second argument of `listItems`.

`create_item`, `update_item` and `delete_item` all return proposals a human
confirms. Only `find_items` executes, because a read cannot persist a mistake.

### What is left to close this step

The agent is verified against the live model through `npm run check:interpret`.
The route is not verified at all — nothing has exercised the session, the SQL, or
the status codes.

Two neighbours block a clean run, and both are worked around by hand for now:

1. **No categories route exists.** `listCategories` returns `[]` for a real
   household, the prompt renders an empty category list, and every sentence comes
   back as `question`. Insert a category row directly before testing.
2. **`POST /inventory/item` is still 501.** Nothing can put an item in the table,
   so `find_items` returns `{ items: [], total: 0 }` — correct, but it proves
   nothing. Insert an item row directly to see rows come back.

Then call `POST /inventory/interpret` with a real session cookie: an add, a query,
and something ambiguous.

### Checkpoint

- [ ] A `find_items` sentence returns actual rows, scoped to my household
- [ ] A `create_item` sentence returns a proposal and writes nothing
- [ ] An unparseable answer returns 422 with `interpretationFailed`
- [ ] I can say why `create_item` doesn't commit, and where `household_id` enters
      the flow

Then ask for step 5 — the categories module, CRUD routes before its agent, so the
proposals it produces have somewhere to commit. The ten-turn clarification
exchange is still unbuilt; `exchange_id` is parsed and ignored. `PRD.md:470-478`
settles the cap and says the exchange is ephemeral, leaving one open question:
whether the turns live server-side keyed by `exchange_id`, or come back from the
client on each request.
