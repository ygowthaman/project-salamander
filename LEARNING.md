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

## Step 4 — The route

**File:** `node-server/src/api/inventory.ts`

**Concept:** the trust boundary in code. The agent returns a *proposal*; the route
is where session identity is added back, where a query becomes SQL, and where
nothing is written yet.

### Write this

Replace the body of `POST /inventory/interpret`:

```ts
const user = request.user!;

const categories = await listCategories(db, user.householdId);
const result = await interpret(
  parsed.data.text,
  categories.map((c) => ({ id: c.id, name: c.name })),
);

if (!result) {
  return response.code(422).send({ detail: interpretationFailed });
}

if (result.type === "question") {
  return response.send({ type: "question", question: result.question });
}

if (result.type === "find_items") {
  const { items, total } = await listItems(db, user.householdId, user.id, {
    q: result.q ?? undefined,
    categoryId: result.category_id ?? undefined,
    limit: 50,
    offset: 0,
  });
  return response.send({ type: "items", items: items.map(serialiseItem), total });
}

return response.send({ type: "proposal", item: result.item });
```

### Why the identity fields appear here and nowhere earlier

`user.householdId` and `user.id` enter the flow for the first time in this
function. They come off the session, they are passed as *arguments* to
`listCategories` and `listItems`, and they never touched the model — not on the way
out (no slot in the schema) and not on the way in (the prompt names no household).
Everything the model influenced is in `result`; everything that decides *whose data
this is* comes from `request.user`. Keep those two on separate lines of the call
and they can never be confused for one another.

### Why `create_item` returns a proposal

`PRD.md:428` — *the model's output is a proposal, never a write*. `find_items`
executes because a read is reversible and cannot be wrong in a way that persists;
`create_item` goes back to the user for confirmation and is committed by a later
call to `POST /inventory/item`, which re-validates it against `createItemBody` as
if it had been typed into the form.

That is the payoff for deriving both schemas from `domain/inventory.ts`: the
proposal is already in the shape the commit route accepts, so there is no
translation layer where a field could be quietly added.

### Why the union is dispatched with early returns

Each member is a different service call, a different response shape, and a
different amount of risk. Writing them as three early returns rather than a shared
envelope keeps that visible — and because `Interpretation` is a discriminated
union, TypeScript narrows `result` inside each branch and will not let you read
`result.item` in the `find_items` arm.

If you add `update_item` to the schema later and forget this function, the compiler
will not catch it — the branches still typecheck, the new member just falls through
to the final return. Assign `result` to a `never`-typed variable after the last
branch if you want that error at compile time.

### What is deliberately not here yet

`exchange_id` stays unused. The ten-turn clarification loop needs conversation
state, which is its own design problem — where it lives, when it expires, what a
turn costs. Step 5.

### Verify it

`npm run typecheck`, then run it against the live app with a real session cookie.
Three sentences, three shapes: an add, a query, and something ambiguous.

### Checkpoint

- [ ] The route calls `interpret` with categories it fetched, and passes scope to the repositories as arguments
- [ ] A `find_items` sentence returns rows; a `create_item` sentence returns a proposal and writes nothing
- [ ] An unparseable answer returns 422 with `interpretationFailed`
- [ ] You can say why `create_item` doesn't commit, and where `household_id` enters the flow

Then ask for step 5 — the clarification exchange and its turn counter.
