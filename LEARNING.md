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

## Step 5 — One sentence, many items, and the exchange that resolves them

**Concept:** the unit of interpretation is the **sentence**, not the item. A
sentence can name three things, and either all three resolve or none of them
commit. Everything else in this step follows from that: the union goes plural, the
confirmation table grows per-row controls, and the clarification exchange exists so
a sentence that only half resolves has somewhere to go.

### Carried from step 4

Two checkpoints never ran. The write routes that blocked them are live now, so both
are cheap:

- [ ] A `find_items` sentence returns actual rows, scoped to my household
- [ ] An unparseable answer returns 422 with `interpretationFailed`

Chase the `401` on `GET /inventory/items/grouped` before either. The app is being
served from `http://192.168.142.129:5173`, and `SameSite=Lax` cookies with no
`COOKIE_DOMAIN` behave differently from a `localhost` origin — neither checkpoint
can pass if the session never arrives.

### 1. The union goes plural

In `agents/inventory.ts`, `create_item` carries one `item` and `update_item` one
`q` + `changes`. But *"Add 1984 and Origin to books"* is one sentence and two
items, and *"we need eggs, milk, bread"* is three updates.

- `create_item` → `items: proposedItem[]`
- `update_item` → an array of `{ q, category_id, changes }`
- The prompt has to say so, and say that one sentence may name several things.

Then follow it down: `services/inventory.ts` resolves each selector separately, so
`resolveNamedItem` runs per element; `Interpreted` carries arrays; `api/inventory.ts`
serialises them; `frontend/src/types/index.ts` widens `Interpretation`.

The frontend is already ready — `proposalsFrom` returns `Proposal[]` and the
confirmation table renders N rows.

**The rule that makes this more than a shape change:** if *any* element fails to
resolve, the whole sentence goes into clarification rather than committing the
parts that did (PRD §2.5.8). Half a sentence landing leaves me to work out which
half.

**Decide `delete_item` too.** *"Remove 1984 and Origin"* is the same problem, and a
union where two of three write operations are plural is a shape every reader has to
remember twice.

### 2. View and Dismiss on the confirmation table

- **Dismiss** drops the row. It touches no server.
- **View** loads the row into the form and expands it, so a partially correct parse
  can be corrected before it is saved.

**The thing to notice:** `InventoryItemForm` prefills only from `item`, and its
effect clears every field when `item` is null. A `create` proposal is a set of
*fields*, not a row — so View on one is the create form with the values filled in,
and there is nothing to prefill from. The form needs a second prop for that:

```ts
values: NewInventoryItem | null;   // prefill; what a create proposal supplies
item: InventoryItem | null;        // the row, when one exists
```

View on a create proposal passes `values` with `item` null and the mode left at
`create`, so Save posts as it always does. View on an update proposal passes the
real row.

### 3. The ten-turn exchange

`exchange_id` is parsed in `interpretBody` and ignored. Settle the open question
first: do the turns live server-side keyed by `exchange_id`, or come back from the
client on each request?

`ARCHITECTURE.md` answers it — in memory, server-side, reaped on a timer, with
session affinity as a consequence rather than a correctness requirement. **A
client-supplied turn count is not a count:** the cap is the only thing bounding
cost, so it cannot be a number the caller sends.

Then the left pane renders it (conflict **C12**): a pending question, the turns so
far, and the **server-written** ten-turn failure that points at the form. A model
that has just failed ten times to understand the request is not the thing to
explain the failure.

### Checkpoint

- [ ] *"Add 1984 and Origin to books"* produces two rows in the confirmation table
- [ ] *"we need eggs, milk, bread"* produces three update rows
- [ ] A sentence where one item resolves and one does not writes nothing, and asks
- [ ] View on a proposal opens it in the form; Dismiss removes it
- [ ] An exchange that never resolves fails at turn ten with server-written copy
- [ ] I can say why the turn counter lives on the server and not in the request

Build them in that order. The plural shape changes the wire everything else in this
step reads, so layering the exchange onto a shape still in flux means debugging both
at once.

Then ask for step 6.

### Loose ends

- `agents/category.ts` exists and `npm run check:interpret` exercises it, but no
  route calls `interpretCategory`, and its prompt describes a `q` selector the
  schema does not have — the schema selects on `name`.
- `GET /inventory/items` (the flat list) and `POST /inventory/items/:id/stock` still
  answer 501.
- `npm test` runs `tsx test/auth-guards.ts`, and that file is not in the tree.
