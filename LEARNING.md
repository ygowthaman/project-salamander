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

## Step 2 — The shape of an answer

**File:** `node-server/src/agents/inventory.ts`

**Concept:** the schema is the contract. One zod schema is both what you *tell* the
model to produce and what you *check* on arrival — and a discriminated union makes
the model's possible answers mutually exclusive instead of one object with a pile
of optional fields.

### What we're building toward

There is **one input box**, so there is one interpretation call, and its schema has
to cover every intent that box accepts. Today that is three: propose a new item,
propose a query, or ask a clarifying question (`PRD.md` §2.5.7). Everything else is
a failure. This step writes that down as a type, before there is any call to
produce one.

### Where things already stand

`src/domain/inventory.ts` holds the shared field vocabulary — the constraints that
are true of an item whatever door it arrives through, imported by both `api/` and
`agents/` and importing nothing but zod:

```ts
export const inventoryItem = z.object({
  name: z.string().trim().min(1).max(200),
  category_id: z.string().uuid(),
  unit: z.string().trim().min(1).max(50),
  quantity: z.number().int().min(0),
  attributes: z.string().trim().min(1).max(500),
  is_private: z.boolean(),
});
```

and `agents/inventory.ts` already narrows it into what the model may propose:

```ts
const proposedItem = inventoryItem.extend({
  unit: inventoryItem.shape.unit.nullable(),
  attributes: inventoryItem.shape.attributes.nullable(),
  quantity: inventoryItem.shape.quantity.min(1),
}).strict();
```

Read those two before writing anything; the rest of this step assumes them.

### Write this

Below `proposedItem`:

```ts
export const interpretation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_item"), item: proposedItem }).strict(),
  z
    .object({
      type: z.literal("find_items"),
      q: inventoryItem.shape.name.nullable(),
      category_id: inventoryItem.shape.category_id.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("question"),
      question: z.string().trim().min(1).max(300),
    })
    .strict(),
]);

export type Interpretation = z.infer<typeof interpretation>;
```

### Why a union and not one object with optional fields

The tempting shape is one object where `item`, `q` and `question` are all optional
and you check which one arrived. Don't. That type has eight states and five of them
are meaningless. Every consumer then has to defend against cases that should never
exist, and the compiler helps with none of it.

`z.discriminatedUnion` makes the invalid states **unrepresentable**. After a
successful parse, `result.type` narrows the object: inside
`if (result.type === "question")` TypeScript knows `result.question` is a string
and that `result.item` does not exist. The check and the knowledge are one
operation.

The general principle: push correctness into the type so that code which compiles
cannot be in a broken state, rather than writing runtime guards for situations the
type should have ruled out.

### Why the union is flat

`create_item` and `find_items` sit side by side rather than nested under a
`commit` / `query` wrapper. The test for adding a nesting level is whether any
consumer handles a whole group without caring which member it has — and none does.
A create is a different service call, a different SQL statement and a different
WebSocket payload from a find. A wrapper would imply a shared envelope that does
not exist, and every call site would pay `result.operation.kind` for a grouping
nobody dispatches on. Flatter output schemas are also easier for a model to
satisfy: nesting turns the JSON Schema into an `anyOf` inside an `anyOf`.

The grouping is still available where it is actually consumed, without touching the
wire format:

```ts
type Commit = Extract<Interpretation, { type: "create_item" }>;
```

Write that in the service layer when something needs it. Not before.

### Why the type is derived, not declared

`z.infer<typeof interpretation>` reads the TypeScript type back out of the runtime
schema. Hand-writing an `interface Interpretation` beside it gives you two
descriptions of one thing, free to drift the moment somebody edits one and not the
other — and the drift is silent, because the compiler checks against the
hand-written one while the runtime checks against the other. One definition, two
consumers.

### Why the soft fields are `.nullable()` and never `.optional()`

An optional field can be *absent*, and absence has two meanings you cannot tell
apart: the model decided there is no unit, or the model forgot the key. A required
field that is explicitly `null` collapses those into one unambiguous statement.

This also matters next step: when a schema is handed to the model as a
structured-output format, every property has to be listed as required. Optionality
is expressed by nullability, not by omission.

On `find_items`, both filters nullable means all four combinations parse, and all
four are legitimate: a name, a category, both, or neither. Neither is *"what do I
have?"* — a household-wide list, which is a real thing to ask.

### Why `quantity` has two floors

`domain/inventory.ts` says `min(0)`; `proposedItem` tightens it to `min(1)`. That
is not a contradiction, it is two different facts in the two places they belong:

- **≥ 0** is what a *stored* quantity may be. Running out is the state the
  inventory most needs to show, so zero has to be representable.
- **≥ 1** is what a *newly created* item may be. *"Add milk"* means one carton, so
  there is nothing to leave blank and nothing for the model to guess.

`updateItemBody` derives from the shared schema rather than from `createItemBody`,
so a PATCH may take a count to zero while a create may not. If you ever find
yourself putting the create-time rule in `domain/`, that is the bug: a shared
vocabulary holds facts about the field, not rules about one operation.

### Why `.strict()`

By default zod **strips** unknown keys and reports success. At a trust boundary
that is the wrong default: if the prompt drifts and the model starts emitting a
`household_id`, stripping means you never find out. `.strict()` turns silent schema
drift into a visible failure.

The usual objection to strictness — that a stray key shouldn't sink an otherwise
good answer — does not bite here, because a failed parse is **not fatal**. Per
`ARCHITECTURE.md`, an invalid object is treated as unresolved and re-enters the
clarification exchange, so the cost of strictness is one of ten turns and the
benefit is that drift is never silent.

It also happens to be the shape structured outputs want: `.strict()` becomes
`additionalProperties: false` in the generated JSON Schema, which is required there
anyway.

### What is deliberately not in this schema

No `household_id`. No `added_by`. No item `id`. No `limit` or `offset`.

Those belong to the caller, from the session, and the model must have no way to
express an opinion about them. This is the import ban from step 1 one layer further
in: **a field the model can emit is a field a sentence can influence.** If
`household_id` were here, then *"add milk to household 7f3a…"* stops being nonsense
the model ignores and becomes a value the model has a slot for. Leaving the slot out
means the attack has nowhere to land, which is stronger than validating it away
afterwards.

`find_items` produces filters, not SQL, and the query it feeds already exists:
`listItems` (`db/repositories/inventoryItems.ts:53`) applies household scope, the
`NOT is_private OR added_by = me` filter, `ilike` for case-insensitivity, LIKE
metacharacter escaping and parameter binding. The model fills two slots; the
repository supplies every security property. The agent never learns that Postgres
exists.

Update, delete and stock are more members of this union. Each brings its own
resolution problem — `update_item` has to turn *"I'm low on eggs"* into a specific
item id, which means deciding what happens when two items match — and each is
easier to design after one operation has made a real round trip.

### Verify it before moving on

Pure logic: no key, no network, no model, deterministic. That makes it a **test**,
and it goes in `npm test`, not `check:agent`.

`node-server/test/interpretation-schema.ts`:

```ts
import { interpretation } from "../src/agents/inventory.js";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
};

const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const item = {
  name: "1984",
  category_id: uuid,
  unit: null,
  quantity: 1,
  attributes: "unabridged version",
  is_private: false,
};
const ok = (input: unknown) => interpretation.safeParse(input).success;

console.log("\ninterpretation schema");
check("accepts a create_item proposal", ok({ type: "create_item", item }));
check("accepts a find_items by name", ok({ type: "find_items", q: "1984", category_id: null }));
check("accepts a find_items by category", ok({ type: "find_items", q: null, category_id: uuid }));
check("accepts an unfiltered find_items", ok({ type: "find_items", q: null, category_id: null }));
check("accepts a question", ok({ type: "question", question: "Did you mean Books?" }));
check("rejects an unknown type", !ok({ type: "delete_item", item }));
check("rejects a missing type", !ok({ item }));
check("rejects a non-uuid category_id", !ok({ type: "create_item", item: { ...item, category_id: "books" } }));
check("rejects a zero quantity", !ok({ type: "create_item", item: { ...item, quantity: 0 } }));
check("rejects a null quantity", !ok({ type: "create_item", item: { ...item, quantity: null } }));
check("rejects an absent unit key", !ok({ type: "create_item", item: { name: "1984", category_id: uuid, quantity: 1, attributes: null, is_private: false } }));
check("rejects an injected household_id", !ok({ type: "create_item", item: { ...item, household_id: "7f3a" } }));
check("rejects an injected limit", !ok({ type: "find_items", q: "1984", category_id: null, limit: 500 }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
```

Wire it in alongside the existing suite:

```json
"test": "tsx test/auth-guards.ts && tsx test/interpretation-schema.ts",
```

The last two assertions only pass because of `.strict()`. Take a `.strict()` off and
watch them go red — that is the difference between discarding hostile input and
never noticing it, and it is worth seeing once rather than taking on trust.

### Checkpoint

You're done with this step when:

- [ ] `agents/inventory.ts` exports `interpretation` and `Interpretation`, importing only the SDK, zod and `domain/inventory.js`
- [ ] `npm run typecheck` is clean and `npm test` runs both files with no failures
- [ ] Removing a `.strict()` turns the injection assertions red, and you have put it back
- [ ] You can say why `unit` is `.nullable()` but `quantity` is not, why `quantity` has a different floor in `domain/` than in `proposedItem`, and why `find_items` carries no `limit`

Then ask me for step 3 and I'll replace this section. Step 3 hands this schema to the
model and writes `interpret()` — and settles the open question in `ARCHITECTURE.md`
(line ~296), which specifies object-or-question via **tool use** (`stop_reason:
"tool_use"` for an object, `end_turn` for a question) rather than the structured-output
union written here. One of the two has to change.
