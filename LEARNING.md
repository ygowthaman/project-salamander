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

## Step 6 — What the model is allowed to see

**Concept:** the prompt is an interface, and its contents are three decisions at
once — **privacy** (whose rows go in), **cost** (how many, every turn), and
**correctness** (what the model can resolve without asking). Right now it sees the
household's categories and nothing else, which is why *"the 2% one"* costs a whole
extra turn: the model cannot tell two milks apart, so the exchange has to.

### 1. Assemble the member's items

`interpretSentence` fetches categories and hands them to `interpretInventory`. Add
the items the same way — `listItems` already applies the visibility filter
(`NOT is_private OR added_by = me`), so the read is one call, not a new query.

The shape is the decision. Name and attributes are what disambiguate; quantity and
unit are what an update is measured against. Everything else — timestamps, author,
the row's id — is either noise or a new power handed to the model.

**Bound it before you build it.** A prompt that carries every row grows with the
household, on every one of up to ten turns. Decide now what happens at 500 items:
a cap, a category filter driven by the sentence, or a search. There is no right
answer, but "it will be fine" is the wrong one, and the answer belongs in
`ARCHITECTURE.md` once you pick it.

### 2. The ids question

Give the model item ids and it can select a row directly, which would make
`resolveSelector` look redundant. It is not, and this is worth being able to argue:

- An id in the prompt is **selection**, not scope. It only names rows already
  filtered to this member, so the model cannot reach past the filter by echoing one.
- Server-side resolution stays regardless, because the model may return an id that
  was reaped, deleted by someone else mid-exchange, or invented outright.

So the question is not *"ids or resolution"* — it is whether ids buy enough
first-turn accuracy to be worth the tokens. Decide it deliberately.

### 3. Watch what stops happening

If this works, `ambiguous` failures get rare and most sentences end at turn one.
That is the measurement: the exchange you built in step 5 should now be the
exception, not the path.

`ARCHITECTURE.md` flags prompt caching as unproven at this size. The
categories-plus-items block is the stable prefix a `cache_control` marker would
cover — but measure the token count first. A cache that saves nothing is
complexity bought for a feeling.

### Checkpoint

- [ ] *"we're low on the 2% milk"* resolves in one turn with two milks in stock
- [ ] An item another member marked private never appears in my prompt
- [ ] I know what this prompt costs, in tokens, for a realistic inventory
- [ ] I can say why item ids in the prompt do not weaken server-side scoping

### Loose ends

- `agents/category.ts` still has no route, and its prompt describes a `q` selector
  the schema does not have — the schema selects on `name`.
- `GET /inventory/items` (the flat list) and `POST /inventory/items/:id/stock`
  answer 501.
- `npm test` runs `tsx test/auth-guards.ts`, and that file is not in the tree.
- The interpretation path returns proposals and writes nothing itself; the PRD
  leaves confirmation-before-delete open (§2.5.9 *TBD*) and `ARCHITECTURE.md` now
  describes the confirmation table as built. Settle what the product does.

Then ask for step 7.
