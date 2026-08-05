# Inventory Context

Working context for the **inventory module** — the tracker for building it across multiple sessions.

**How to use this file.** It has three jobs, in this order:

1. **Spec digest** — what inventory has to be, gathered from [`PRD.md`](../PRD.md) §2.5 (and §2.2/§2.3,
   which it depends on) so a session does not have to re-derive it.
2. **Plan** — the work cut into small chunks, each independently shippable.
3. **State** — what is done, what is next, and every design decision taken while building, with the
   reason. Update the *Status* and *Decision log* sections at the end of each session; that is what
   makes the next one resumable.

> **`PRD.md` is the source of truth.** Where this file disagrees with it, the PRD wins and this file
> is stale — fix this file. Where the *code* disagrees with it, the code is wrong and goes in the
> [§9 drift ledger](#9-drift-ledger) to be corrected. This inverts the arrangement that governed
> until 2026-08-05, when the PRD was rewritten and inventory specified as §2.5 — see
> [D5](#d5--the-prd-is-authoritative-again-d2-is-retired).

This file tracks *the build*. Durable "why this folder is shaped this way" reasoning still belongs in
the folder `*_CONTEXT.md` files (`node-server/src/db/DB_CONTEXT.md`, `src/api/API_CONTEXT.md`,
`src/agent/AGENT_CONTEXT.md`) — promote it there as each chunk lands, rather than letting this file
become the only place it lives.

---

## 1. What the inventory module is

An `inventory_item` is **anything the household tracks** — a grocery, printer ink, a book —
classified by a household-defined category it references via `category_id` (PRD §2.5.1). Four things
shape the whole module.

### 1.1 The household owns it, the member is attribution

**Nothing in inventory is owned by a user** (PRD §2.2, §2.5). Every domain table carries
`household_id`, and that is what every query filters on. `users.household_id` is NOT NULL and always
present — auto-provisioned when a user skips the create form — so there is exactly one ownership
shape and no lone-user second case.

Two user columns sit on the item anyway, and neither is ownership:

- **`added_by_user_id`** — who put this on the list (PRD §2.2.9). Displaying that name is the entire
  reason a soft-deleted user's row survives (PRD §2.2.8), so this must be `ON DELETE SET NULL`,
  **never CASCADE** — a departing housemate must not delete the household's stock.
- **`is_private`** — visible only to `added_by_user_id`, **including to admins** (PRD §2.2.9,
  §2.3.1). This is the one place a user column is load-bearing for a read: every read filters
  `NOT is_private OR added_by_user_id = me`.

Private items are **deleted** when their owner is soft-deleted or leaves (PRD §2.2.8, §2.2.10) —
never inherited by the household, never carried to another one.

### 1.2 Two ways to do everything, and neither is a subset

PRD §2.5.3 is explicit: there are **four operations — add, read, update, delete** — and each is
available two ways, through a **form** and by **writing a sentence**. Both are permanent, and neither
is a mode of the other.

**The form path never touches the LLM** (PRD §2.5.3). If the model is slow, misconfigured or down,
inventory stays fully usable. This is why the two paths are not layered: the NL path is not a front
end onto forms, so losing it costs convenience and never function. It is also the designated fallback
when an interpretation fails (PRD §2.5.7) — *the fallback for a failed interpretation cannot itself
be an interpretation.*

Practical consequence for the build: **the form path ships first and completely.** It is the thing
that has to work when the interpreter does not.

### 1.3 Interpretation is a conversation, bounded

The old design was a one-shot parse that 422'd on failure. **It is not that any more.** PRD §2.5.5 to
§2.5.7:

- The server sends the model **three things**: the user's text verbatim, the JSON shape it must reply
  with, and **metadata** (the household's categories, and the items in the asking member's view).
- The model replies with **either a structured object or a question**.
- An unresolved sentence starts a **clarification exchange** — the model asks, the user answers —
  running to a hard cap of **ten exchanges** (one user message + one model reply each).
- At ten, the operation **fails to the form**: the user is told plainly it could not be understood
  and pointed at the form. Nothing is written.
- The exchange is **ephemeral**: not stored, not resumable, dead on reload/navigation/lost
  connection. A restart is a new exchange with a fresh count of ten.

### 1.4 What the model may not do

Three prohibitions, each with a reason in the PRD:

- **Item names are resolved, never invented** (§2.5.7). If *1984* matches nothing, that is a question
  or a plain "nothing tracked" — never a new item conjured to satisfy the sentence.
- **Categories are resolved, never created** (§2.5.7). The exchange refuses and points the user at
  where to add one. *This inverts the pre-2026-08-05 rule and kills the `new_category` DTO field —
  see [D6](#d6--the-exchange-never-creates-a-category-new_category-is-removed).*
- **Nothing partial commits** (§2.5.8). One sentence may name several items; if any part fails to
  resolve, the **whole sentence** enters the exchange rather than committing the parts that did.

### Commit pattern — direct commit, after the exchange resolves

Once a valid object exists: `validate → persist → WS push → UI refresh`. No draft, no approval gate.

Direct commit still applies — the clarification exchange is not an approval step, it is the model
working out what the user meant. Nothing is shown for the user to sign off on; the moment the object
is valid it is written.

What direct commit does **not** remove: the zod validation gate. The server re-validates the model's
output against the same schema it gave the model, and a failure writes **nothing** (PRD §2.5.5). That
is the only thing standing between a bad parse and the database, so it is never optional.

### Invariants (do not negotiate these away mid-build)

- **`household_id` is bound server-side** from the session, never from a model response or a request
  body. Cross-household `{id}` access is **404, not 403** — a 403 confirms the row exists.
- **`added_by_user_id` is bound server-side** too, from the session, and never changes afterwards.
- **Every read filters on visibility**: `NOT is_private OR added_by_user_id = me`. This applies to
  list routes, to the LLM metadata, and to the WS fan-out — all three, or private leaks through the
  one that was forgotten.
- **Privacy is enforced when context is assembled, not by prompting.** A private item that was never
  sent to the model cannot be named back to the wrong person (PRD §2.5.6).
- **Never mention the household to a member at `skip_household = true`** (PRD §2.2.3, §2.5.6) —
  not in UI copy, not in metadata, not in anything the model says back.
- **Model prose reaches the user only as clarification** (PRD §2.5.7). Results are rendered by the
  server from the record: a read renders rows, a write renders what was stored. The ten-turn failure
  message and any "here is where to add a category" direction are **server-written**, not composed by
  the model.
- **Validate the model's output with the same zod schema the route uses.**
- **The WS channel is per-user transport with household fan-out.** Best-effort: REST is the source of
  truth, a dropped socket means stale not broken, and no write's correctness may depend on a push
  landing (PRD §2.5.10).
- **Anything the app groups by is its own table and the model returns its id.** `category` is a
  table; `unit` stays free text — nothing groups or totals by unit, so drift never escapes the row.
- **Never hold a transaction across an LLM call.** Read context in a short transaction, call the
  model with none open, write in another. With a ten-turn exchange this matters more than it did.
- **Inventory must never import `mandates`** (D1). The dependency points one way.

---

## 2. Data model — as shipped

`node-server/src/db/schema/` is a **directory** (`households`, `auth`, `categories`, `inventory`,
`mandates`, barrelled through `index.ts`), not the single `schema.ts` this file used to describe.
Module order follows the acyclic dependency graph: `households ← auth ← categories ← inventory ←
mandates`.

The tables below are **built and match the PRD**; the annotations are the parts that are easy to get
wrong.

```sql
categories                     -- household-defined taxonomy (PRD §2.5.2)
  id, household_id → households(id) ON DELETE CASCADE, name, created_at, updated_at
  -- UNIQUE (household_id, lower(name))  ← case-insensitive; a second "groceries" is a 409
  -- Per HOUSEHOLD, not per user: two people in one house share one set, or the same budget
  --   splits across "their" copies of Groceries.
  -- lower(name) expression index rather than normalise-on-write, because the display casing
  --   the user typed is worth keeping — "Books", not "books".

inventory_items                -- EVERY tracked thing, in its complete form. No reorder columns.
  id, household_id → households(id) ON DELETE CASCADE, name,
  category_id → categories(id) ON DELETE RESTRICT,     -- NOT NULL; delete-with-items is 409 + count
  added_by_user_id → users(id) ON DELETE SET NULL,     -- attribution (§2.2.9), nullable
  is_private BOOLEAN NOT NULL DEFAULT false,           -- visible only to added_by (§2.2.9)
  unit (nullable),                                     -- free text, deliberately
  quantity INTEGER (nullable),  -- null = "tracked, count unknown", a real track-only state
  attributes (jsonb, nullable),  -- freeform: author/edition/isbn, model number — feeds NL search
  created_at, last_updated
  -- INDEX (household_id, name) — the read path
  -- INDEX (category_id) — carries the RESTRICT check and the per-category counts
  -- INDEX (added_by_user_id) — NOT for reads; it serves the departure paths, which must find
  --   and delete one member's private items before the household stops being theirs.
```

And the reorder side — **not part of the inventory module**, listed only because it owns the two
columns that used to sit on the item and because the interpreter reads it (D1, D4):

```sql
mandates                       -- ONE ROW PER REORDERABLE ITEM. ITS EXISTENCE IS THE OPT-IN.
  id, household_id → households(id) ON DELETE CASCADE,
  inventory_item_id → inventory_items(id) ON DELETE CASCADE,
  par_level INTEGER NOT NULL,    -- the quantity to keep on hand; the anchor "low on eggs" maps to
  restock_level (nullable),      -- stock target when a reorder is placed; falls back to par_level
  trigger_condition (jsonb, nullable),   -- {op, field, value}; Phase 2 populates
  shopping_query (nullable),     -- WHAT to buy — "2 × 2L whole milk" where restock_level is just 4
  preferred_product (jsonb, nullable),
  created_at, updated_at
  -- UNIQUE (inventory_item_id) — ONE rule per item (D4). Changing your mind is an UPDATE.
  -- grant_id is DEFERRED to Phase 2: its FK target `grants` does not exist yet.
```

Notes that are easy to get wrong:

- **The item table is what the split protects.** A DVD and a carton of eggs are both fully-described
  `inventory_items` rows; neither carries a column that does not apply to it. "Is this reorderable?"
  is not *"are these two nullable columns filled in?"* but *"does a `mandates` row exist?"* — one
  boolean the database enforces. **PRD §2.5.1 now agrees with this**, so D1/D4 are no longer a
  divergence.
- **Nullable on `mandates` means "not yet supplied", never "inapplicable".** Every row is by
  definition a reorderable item, so par/restock always apply. If a column ever turns up that is
  *inapplicable* to some rows, that is the signal to split again.
- **`quantity` stays on the item.** It is universal — you can own 1 copy of a book — and NL reads
  filter on it. Stock updates must work on items with no `mandates` row at all.
- **`quantity` is `integer`, not `numeric`.** Settled in code; PRD §2.5.1 says only "how much is on
  hand" and does not require fractions. See [D7](#d7--quantities-are-integers).
- **Quantities are stored in the item's base unit.** The model normalises on the way in (*"a dozen"*
  → `12`, *"a loaf"* → `1`).
- **The qualitative word is never persisted.** *"low"* becomes a number on the item; the phrase
  itself is not stored.
- `household_id` on `mandates` is denormalised from the item, following the convention every domain
  table uses. Write it from the item's household, never from a request body.

---

## 3. API surface

Every route requires auth; scope is the household, ownership enforced per `{id}`, visibility filtered
per member.

```
# Categories (PRD §2.5.2) — plain CRUD backing a management page. No LLM, no exchange.
GET    /categories                  -- list, each with its item count
POST   /categories      { name }    -- unique per household, case-insensitive → 409 on duplicate
PATCH  /categories/{id} { name }    -- rename; items follow the id, not the name
DELETE /categories/{id}             -- 409 + item count if items still reference it (RESTRICT)

# Inventory — the form path (shipped as stubs; see §7)
GET    /inventory/items                    -- list; ?q= ?category_id= ?limit= ?offset=
GET    /inventory/items/grouped            -- ?group_by=category|unit
POST   /inventory/items                    -- structured create
GET    /inventory/items/{id}
PATCH  /inventory/items/{id}
DELETE /inventory/items/{id}
POST   /inventory/items/{id}/stock         -- { quantity | delta } — exactly one

# Inventory — the natural-language path (NOT BUILT; frontend calls it against a mock)
POST   /inventory/interpret  { text, exchange_id? }
                                    -- → a committed result, OR a question continuing the exchange
```

### The exchange flow (the shape to implement)

```
1. Parse the body with zod                   { text: "Add 1984 to my library" }
2. Assemble metadata from the DB             categories as {id, name}; items in THIS MEMBER'S VIEW
                                             (NOT is_private OR added_by = me) with names +
                                             attributes; per named item quantity + unit, plus
                                             par_level LEFT JOINed from mandates where it exists
3. Call the model                            text verbatim + response schema + metadata
4. Model returns an object OR a question
   4a. Question  → return it to the client, increment the turn counter, do not write
   4b. Object    → validate with the SAME zod schema; invalid → treat as unresolved
5. At turn 10 with no valid object           fail: server-written message pointing at the form
6. Commit in one transaction                 every item row the sentence named (§2.5.8:
                                             any unresolved part blocks the whole)
7. Push on the household channel             filtered by visibility (private → owner only)
8. Respond with the applied old→new diff
```

Two things this flow must not do: hold a transaction open across a model call, and carry the
exchange in anything durable (PRD §2.5.7 — it is ephemeral).

### The four operations

| Operation | Example | Produces |
|---|---|---|
| **Add** | *"Add 1984 to my books"* | a new `inventory_items` row, category resolved to an existing `category_id` |
| **Read** | *"Do I have 1984?"* | a query DTO → rows rendered in the normal table. Writes nothing |
| **Update** | *"Make my copy of 1984 a special edition"* | a change to an existing item (incl. `attributes`) |
| **Delete** | *"Remove 1984 from my books"* | that row deleted |
| **Stock** | *"low on eggs, out of bread"* | quantity changes — **update** narrowed to `quantity`, not a fifth operation |

**Read matches loosely** — *1984* must find the item whether it is stored as *1984* or *Nineteen
Eighty-Four*, so it resolves against `attributes` as well as `name`, and says plainly that nothing
matches rather than offering the nearest thing (PRD §2.5.8).

**Update and delete require certainty about which item is meant.** A sentence resolving to more than
one item is a question, not a choice the model makes (PRD §2.5.8).

### WS events this module emits

Typed data events, not text. Fan-out is to **every member of the household who may see the row** —
an ordinary item to all of them, a private item to its owner alone (PRD §2.5.10).

```jsonc
{ "type": "inventory.upserted", "items": [ { "id": "…", "name": "1984", … } ] }
{ "type": "inventory.deleted",  "ids": ["…"] }
{ "type": "category.upserted",  "categories": [ … ] }
{ "type": "category.deleted",   "ids": ["…"] }
```

---

## 4. Plan — chunked

Status key: `[ ]` not started · `[~]` in progress · `[x]` done

### Chunk 0 — preconditions

- [ ] **Apply migrations against a live local Postgres.** `drizzle/` holds a single squashed
      `0000_nasty_silver_centurion.sql`; it has never been run anywhere. This is the first real test
      of the migration path — verify it before stacking new migrations on it.
- [ ] **Decide the test lane for database behaviour.** `npm test` is a hand-rolled `tsx` script using
      `app.inject()` and is **deliberately database-free**. But the visibility filter, the
      case-insensitive unique index, `ON DELETE RESTRICT` and the `SET NULL` attribution path are all
      DB behaviour. Either add `npm run test:db` against a local Postgres or accept manual
      verification and say so.

Route plugins are registered in **`app.ts`**; `server.ts` only binds the port and runs migrations.

### Chunk 1 — schema `[x]`

- [x] `categories`, `inventory_items`, `mandates` in `db/schema/`, household scoped, with
      attribution and privacy columns
- [x] `UNIQUE (household_id, lower(name))` as an expression index
- [x] Migration generated

### Chunk 2 — the service layer `[ ]` ← **next**

Every handler in `api/inventory.ts` currently stops at `todo()` → 501. The seam is marked; the
service behind it is not written.

- [ ] `db/repositories/{categories,inventoryItems}.ts` — household-scoped
      (`…ForHousehold`), taking a `DbExecutor`. **These do not exist**; the convention every other
      table follows is not yet honoured here.
- [ ] **The visibility filter, in exactly one place.** `NOT is_private OR added_by_user_id = me`
      belongs in the repository, not repeated at each route — repeated, it will be forgotten once.
- [ ] Stock writes: quantity + `last_updated` on the item
- [ ] 409 + item count on category delete-with-items; 404 (not 403) cross-household
- [ ] Tests: household scoping, the visibility filter, adjust arithmetic, track-only items
      (null quantity/unit), and that nothing here imports anything reorder-related

### Chunk 3 — close the PRD gaps in the API `[ ]`

The routes were written before §2.5 existed and are missing what it requires:

- [ ] `publicItem` omits **`added_by_user_id`** and **`is_private`** — the wire shape carries neither,
      so no client can show attribution or mark a thing private
- [ ] `createItemBody` / `updateItemBody` have no `is_private` field — a private item **cannot be
      created** through the API as it stands
- [ ] `/inventory/items/grouped` takes `household_id` **from the query string** on the stated grounds
      that "a user can belong to more than one household" — flatly contradicting PRD §2.2.2. Derive
      it from the session and drop the parameter
- [ ] The `preHandler` comment says "Inventory is per-user in its entirety" — stale, and the opposite
      of §2.5
- [ ] Frontend calls `/inventory?groupBy=category`; the backend serves
      `/inventory/items/grouped?group_by=…`. One of the two is wrong

### Chunk 4 — WebSocket push channel `[ ]`

- [ ] `api/websocket.ts` — attach a route to the already-registered `@fastify/websocket`
- [ ] Auth **at the handshake** (cookie rides the upgrade) + `Origin` check (CORS does not apply)
- [ ] Per-user socket registry, **household fan-out**: `publish(householdId, event, visibility)`
- [ ] **Visibility on the push**, not just the read: a private item reaches its owner only
- [ ] Re-check membership per push — a socket outlives the 15-minute access token, and a member can
      leave the household mid-session (PRD §2.2.10)
- [ ] Frontend WS client **with reconnect** (capped backoff, visible "reconnecting", re-fetch on
      reconnect)

### Chunk 5 — frontend: categories page + inventory table `[~]`

- [ ] **Routing.** `App.tsx` is a binary gate and there is **no router installed**. Categories,
      inventory and settings are separate pages — `react-router-dom` (deep links, back button) or a
      hand-rolled view switch. The module's only genuinely new dependency.
- [x] **Styling convention — settled.** Mantine (`@mantine/core` + `@mantine/hooks`, themed in
      `src/theme.ts`) with Tabler icons. Anything beyond Mantine's props goes in a sibling
      `*.module.css`; **no inline `style={{…}}` objects.**
- [~] `InventoryPage` + `InventoryItemCard` exist, **driven by
      `api/mocks/inventory.groupedByCategory.json`** — real once Chunk 2 lands
- [ ] Categories management page: list with item counts, create / rename / delete (a **form**)
- [ ] Item create/edit form, category as a **picker** over the household's categories, plus a
      **private** toggle and the **added-by** name on each item
- [ ] Live updates from the WS channel

**The milestone for this chunk: the form path is complete and the module is fully usable with the LLM
switched off.** PRD §2.5.3 requires exactly that, and it is also what makes the interpreter's failure
mode acceptable.

### Chunk 6 — the interpretation exchange `[ ]`

- [ ] `agent/` first real function: prompt + tool schema, returning **an object or a question**
- [ ] Shared zod schema used by both the agent layer and the route
- [ ] Metadata assembly: categories + **visibility-filtered** items + `par_level` where a mandate
      exists
- [ ] Turn counter, **hard cap of ten**, server-written failure message pointing at the form
- [ ] Exchange state held **in memory only** — ephemeral, dead on reload (PRD §2.5.7)
- [ ] Category refusal path: explain it is missing, direct to where to add it, **never create it**
- [ ] Unresolved item names → a question, never a new row
- [ ] Whole-sentence semantics: any unresolved part blocks the entire commit
- [ ] Timeout + one bounded retry on transient errors; clean user-facing failure, never a 500
- [ ] `cache_control: { type: "ephemeral" }` on the static prefix; **verify
      `usage.cache_read_input_tokens` is non-zero** rather than assuming
- [ ] Log tokens / latency / model per call — a ten-turn exchange costs ten calls

### Chunk 7 — the remaining operations `[ ]`

Chunk 6 establishes the machinery on **add** and **stock**. This adds the rest:

- [ ] **Read** — query DTO → rows in the normal table, matching name + `attributes` loosely
- [ ] **Update** — including `attributes` edits (*"make my copy a special edition"*)
- [ ] **Delete** — with the multi-match refusal, and whatever PRD §2.5.8's open confirmation question
      settles on

### Chunk 8 — golden eval set + cost logging `[ ]`

- [ ] Scripted golden set, runnable as a regression gate
- [ ] Cases: multi-item sentences, qualitative bands, unit expressions, unresolved names, **missing
      categories (the refusal path)**, **multi-turn exchanges that converge**, **exchanges that hit
      ten**, adversarial input
- [ ] **A privacy case**: another member's private item must never appear in assembled metadata
- [ ] Token/latency/model logging surfaced somewhere readable

**Out of scope:** grants, budgets, windows, runs, the NL mandate interpreter and the rule half of
`mandates`; reorder-window auto-trigger on stock update; restock-on-placement; any pause/resume
mechanism (D4); and **creating categories or other metadata from inside the exchange** (PRD §2.5.7 —
explicitly deferred, not refused on principle).

---

## 5. Open questions

### 5.1 For the PRD to answer (this file must not decide these)

| Question | Why it matters here |
|---|---|
| **What do *"low"* / *"out"* / *"plenty"* map to?** §2.5.8 uses *"low on eggs and milk, out of bread"* as an example but never defines the mapping. The build needs it, and it needs both bands: **anchored** on `mandates.par_level` where a row exists, **unanchored** otherwise (a book has no mandate, ever). | Blocks Chunk 6 |
| **Does a committed write store the sentence that produced it?** §2.5.7 raises this and explicitly declines to settle it. Nothing stores it today. | Decides whether stock writes need any record beyond the item row |
| **Reorder / `mandates` is not in the PRD.** §2.5.1 says only that the item record says nothing about buying. The table is built. | Chunk 6's anchored band depends on it |
| **Category management surface** — creating, renaming, deleting, and what happens to a category with items (§2.5.2 TBD) | Blocks the categories page |
| **Category seeding for a new household** — empty, or a starter set? (§2.5.2 TBD) | First-run experience |
| **Is an NL delete confirmed before it happens?** (§2.5.8 TBD) | Chunk 7 |

### 5.2 Build decisions this file owns

| Decision | Assumed default | State |
|---|---|---|
| `attributes` shape | Fully freeform per-item `jsonb` | Open; deferrable until read recall demands conventions |
| Read matching depth (`ILIKE` → `pg_trgm` → full-text) | `ILIKE` over `name` + `attributes` | Open — Chunk 7 |
| Where exchange state lives | In-process map keyed by exchange id, dropped on disconnect | Open — Chunk 6. It is ephemeral by spec, so this must **not** become a table |
| One `/inventory/interpret` for all operations, or a route per operation? | One route; the model classifies the intent | Open — Chunk 6 |
| Frontend routing: `react-router-dom` vs a hand-rolled view switch | `react-router-dom` — deep links and the back button matter for a table-driven app | Open — Chunk 5. The only new dependency the module needs |
| Test lane for DB behaviour | A second script (`test:db`) against a local Postgres, following the existing `check()` idiom | Open — Chunk 0 |
| Route prefix for the mandates levels surface | `/inventory/{id}/reorder` reads naturally but puts a reorder route in the inventory namespace; `/mandates/{item_id}` keeps the separation | Open |

---

## 6. Status

**As of 2026-08-05.** The schema is built and correct; nothing above it works.

| Layer | State |
|---|---|
| **Schema** | ✅ `households`, `auth`, `categories`, `inventory_items`, `mandates` — household-scoped, with `added_by_user_id` and `is_private`. Matches PRD §2.5 |
| **Migration** | ⚠️ one regenerated baseline `0000_init.sql` (7 tables), **never run against a live Postgres** |
| **Repositories** | ❌ only `authSessions`, `households`, `oauthAccounts`, `users`. No inventory repositories |
| **Routes** | ⚠️ `api/inventory.ts` is 301 lines of zod schemas, serialisers and route registrations — **every handler returns 501 via `todo()`**. The seam is marked, the service is not written |
| **Agent** | ❌ `src/agent/` holds `AGENT_CONTEXT.md` and no code |
| **WebSocket** | ❌ `@fastify/websocket` registered in `app.ts` with no route attached |
| **Frontend** | ⚠️ `InventoryPage` + `InventoryItemCard` exist and render, **against a JSON mock**. The NL text box calls `/inventory/interpret`, also mocked. No categories page, no router, no WS client |

**Next up:** Chunk 0 preconditions, then Chunk 2 (the service layer) — the routes are waiting on it,
and the frontend is waiting on them.

### Session log

- **2026-07-28** — Created this file. No code written. Plan cut into chunks; decisions **D1**
  (reorder split), **D2** (defer doc updates), **D3** (levels ship in Phase 1), **D4** (fold into
  `mandates`) taken before any code.
- **2026-08-05** — **Rewritten against the new PRD §2.5.** The PRD was rebuilt module by module and
  now specifies inventory directly; households, attribution and privacy landed in schema and routes
  in the meantime. Retired **D2** and inverted the authority statement (**D5**). Recorded **D6**
  (the exchange never creates a category), **D7** (integer quantities), **D8** (the exchange
  supersedes one-shot 422 parsing). The old §8 drift ledger — pending edits to a PRD that no longer
  exists — is replaced by [§9](#9-drift-ledger), which now tracks **code behind the PRD**.

---

## 7. Decision log

Design decisions taken **while building** — the ones not already in the PRD. Each: what, why, and
what it would cost to reverse. Append-only; supersede an entry rather than editing it away.

### D1 — `par_level` and `restock_level` move off `inventory_items`
_2026-07-28 · maintainer_
> **Structure revised by [D4](#d4--reorder_configs-is-folded-into-mandates-one-row-per-item)**: the
> columns live on `mandates`, not a separate `reorder_configs`. **Ratified by PRD §2.5.1 on
> 2026-08-05** — the PRD now states that the item record says nothing about buying the thing, so this
> is no longer a divergence.

**What.** `inventory_items` carries no reorder fields. A reorder row per item holds them, and **the
row's existence is the opt-in**.

**Why.** Otherwise a reorderable grocery and a book share a table where two columns are "not
applicable" for one of them: neither row is complete, every consumer has to know `par_level IS NULL`
means *not-a-reorder-item* rather than *not-yet-set*, and nothing stops a half-filled pair. Opt-in
becomes one FK the database enforces instead of a nullability convention spread across route, agent
and UI code.

**Cost to reverse.** Low: one migration adding two nullable columns plus a copy-across.

### D2 — ~~the authoritative docs are reconciled once, after inventory ships~~ *(RETIRED)*
_2026-07-28 · superseded by D5 on 2026-08-05_

Retired. It assumed a stable PRD that this file would diverge from and reconcile later; the PRD was
instead rewritten wholesale, and the divergences it tracked either evaporated (D1/D4 are now PRD
text) or inverted (the code is what is behind now, not the docs).

### D3 — the reorder levels ship early (par, restock, the opt-in); rules, grants and windows do not
_2026-07-28 · maintainer_

**What.** `mandates` with its levels half, its repository, routes, and a UI opt-in toggle land with
inventory CRUD. The rule half stays null until later.

**Why.** D1 moved `par_level` off the item, leaving the stock interpreter with nothing to anchor
*"low"* against. Two columns is a small price to keep threshold-aware mapping verifiable from the
start rather than retrofitting the eval set later.

**Consequence.** Two permanent bands — **anchored** and **unanchored**. The unanchored one is not a
stopgap; it is what a book or a DVD gets forever. *Note: PRD §2.5 does not currently specify either
band — see [§5.1](#51-for-the-prd-to-answer-this-file-must-not-decide-these).*

### D4 — `reorder_configs` is folded into `mandates`, one row per item
_2026-07-28 · maintainer · revises D1's structure, keeps its rationale_

**What.** `mandates` holds `par_level` and `restock_level` alongside the rule columns, with
**`UNIQUE (inventory_item_id)`**. `active` is dropped. `inventory_items` still carries nothing about
reordering.

**Why.** Multiple mandates per item was the only argument making two tables structurally necessary.
With 1:1 that pressure disappears, and several rules per item complicates evaluation for no user
benefit — the scheduler would need precedence, and the user would have to reason about which fired.
**Changing a rule is an UPDATE, not a second row.** The remaining cases reduce to another field:
levels without a rule is a null `trigger_condition`; pausing is out of scope (raise stock above
`restock_level`); purchase quantity ≠ restock level is `shopping_query` alongside `restock_level`.

**Known cost accepted.** Pausing by raising stock records a level the user does not physically have.
Acceptable while pause is out of scope.

### D5 — the PRD is authoritative again; D2 is retired
_2026-08-05 · maintainer_

**What.** `PRD.md` is the source of truth for this module. This file is a digest of it plus build
state, and it is **never** the operative spec. Where the code disagrees with the PRD, the code is
wrong and goes in [§9](#9-drift-ledger).

**Why.** The arrangement under D2 — this file operative, the PRD stale by agreement — was tenable for
a few weeks and a couple of decisions. It stopped being tenable once the PRD was rewritten: §2.5 now
specifies inventory in more detail than this file ever did, including the household ownership,
attribution and privacy rules that this file had no concept of at all. Two operative specs is how a
session picks the wrong one.

**What it cost to get here.** Every PRD reference in this file pointed at the old numbering (§5.1,
§6, §7, §8.1, §11, §12.x), and those numbers now mean different things. The schema files carry the
same mixture — `categories.ts` cites "PRD §5.1.1" beside `inventory.ts` citing "PRD §2.2.9". That
cleanup is [§9](#9-drift-ledger)'s first item, and it is the concrete bill for deferred
reconciliation.

### D6 — the exchange never creates a category; `new_category` is removed
_2026-08-05 · PRD §2.5.7_

**What.** The interpreter resolves category words onto existing rows or refuses. The
`category_id` **xor** `new_category` DTO shape, and "the server creates a proposed category inside
the same commit transaction", are **removed from the plan**.

**Why.** This inverts the previous invariant (*"item names are surfaced, never invented; categories
are created, not surfaced"*), and the PRD's reasoning replaces it: categories are what statistics and
budgets group by, so a taxonomy that grows a word at a time during interpretation is the drift that
made them records in the first place — and an exchange that can create the records it resolves
against no longer has a fixed set to resolve against, which is what makes its answers checkable.

**Cost to reverse.** Low, and explicitly anticipated: PRD §2.5.7 calls this a scope decision rather
than a permanent one, so a later section may lift it.

### D7 — quantities are integers
_2026-08-05 · settled in code_

**What.** `quantity`, `par_level` and `restock_level` are `integer`. The earlier assumed default was
`numeric`, on the strength of *"half a bag of rice"*.

**Why.** PRD §2.5.1 asks only for "how much is on hand" and never requires fractions. `numeric` comes
back from `pg` as a **string**, which pushes parsing and formatting into every consumer and every
arithmetic path in the stock endpoint, for a case no requirement asks for.

**Cost to reverse.** Moderate and one-directional: widening `integer` → `numeric` is a safe migration,
but every read path then has to handle strings. Revisit if a real fractional case appears.

### D8 — the clarification exchange supersedes one-shot parsing
_2026-08-05 · PRD §2.5.5–§2.5.7_

**What.** An unresolved interpretation no longer returns 422 and stops. It returns a **question**, and
the exchange continues to a cap of ten before failing to the form.

**Why.** PRD's reasoning: a wrong guess is indistinguishable from a deliberate entry, and one extra
exchange is cheap where a quietly wrong record is not.

**What this costs the build, and it is not small.** Three invariants that were previously absolute are
now qualified:

- *"Every LLM call is single-turn, stateless, no message history"* → an exchange carries state across
  up to ten calls. The **calls** stay stateless in the sense that matters (no persona, no streaming,
  structured output via tool use), but the exchange does not.
- *"Never return model prose to the user"* → model prose is now the clarification channel. It is
  **bounded**: results are still server-rendered, and the failure message and any UI directions are
  server-written.
- *Cost per interpretation* is now up to ten calls, not one. Log per-call and per-exchange.

**Cost to reverse.** High — the cap, the ephemerality and the failure-to-form path are all PRD text
now, so reverting is a spec change rather than a build decision.

---

## 8. Reference map — old PRD § → new

The old numbering appears throughout this repo's comments and docs. When you meet one:

| Old | New |
|---|---|
| §3 (users, auth, sessions) | §2.1 Users, §2.4 Authentication |
| §5.0 (input model) | §2.5.3 Two ways to do everything |
| §5.1 (inventory management) | §2.5.1, §2.5.4, §2.5.8 |
| §5.1.1 (categories) | §2.5.2 |
| §5.8 (NL inventory search) | §2.5.8 — **now an in-scope operation, not a later phase** |
| §6 (data model) | §2.5.1 (prose only; no schema section in the new PRD) |
| §7 (API surface) | no equivalent — the new PRD does not list routes |
| §8.1 (interpretation) | §2.5.5–§2.5.7 |
| §8.4 (WS push channel) | §2.5.10 |
| §11 (acceptance criteria) | no equivalent yet |
| §12.x (open decisions) | inline `*TBD:*` notes in the relevant section |

---

## 9. Drift ledger

**Append-only.** Under D5 the PRD is authoritative, so this list is now **where the code and the
surrounding docs are behind the PRD**, not the reverse. Work it down; do not let it grow silently.

### Code behind PRD §2.5

- [ ] **`api/inventory.ts` `publicItem`** omits `added_by_user_id` and `is_private` — §2.5.1 requires
      both on the item and §2.5.9 requires attribution to be displayable
- [ ] **`api/inventory.ts` `createItemBody`/`updateItemBody`** have no `is_private` — a private item
      cannot be created or unmarked through the API
- [ ] **`api/inventory.ts` `groupedQuery`** takes `household_id` from the query string, justified in a
      comment by *"a user can belong to more than one household"* — **contradicts PRD §2.2.2**, which
      states a user belongs to exactly one at a time. Derive from the session; drop the parameter
- [ ] **`api/inventory.ts` `preHandler` comment** — "Inventory is per-user in its entirety" is the
      opposite of §2.5
- [ ] **No visibility filter exists anywhere yet** — §2.5.6, §2.5.9 and §2.5.10 all depend on it
- [ ] **Frontend/backend contract mismatch** — the client calls `/inventory?groupBy=category`, the
      server serves `/inventory/items/grouped?group_by=…`

### Stale PRD references in code and docs

- [ ] **`schema/categories.ts`** cites "PRD §5.1.1"; **`schema/inventory.ts`** and
      **`schema/mandates.ts`** cite "PRD §6", "§12.21", "§12.23", "§5.10" — all old numbering, some
      in the same file as correct new references (§2.2.9, §2.2.8). Use [§8](#8-reference-map--old-prd--to-new)
- [ ] **`ROADMAP.md`** is written entirely against the old PRD's build order and §-numbers, and its
      Phase 1/2 split (search in Phase 2, no NL delete) no longer matches §2.5.3's four operations in
      both paths
- [ ] **`ARCHITECTURE.md`** cites old numbering throughout — `:294` names PRD §6 as the target data
      model, plus §5.1.1, §5.0, §3, §12.6, §1, §9 elsewhere
- [ ] **`API_CONTEXT.md`** contradicts itself: `:4` says route plugins are registered by `app.ts`
      (correct), `:118` tells you to register a new one in `server.ts` (wrong). Fix `:118`
- [ ] **`AGENT_CONTEXT.md` `:31`** — *"If you find yourself adding a `messages` array, a system
      persona, or a streaming generator here"* is written as a stop sign. Under PRD §2.5.7 a
      ten-turn exchange **needs** a messages array, so this rule now has to distinguish the two
      things it currently conflates: conversation state within one interpretation (allowed, capped,
      ephemeral) versus a chat surface (still forbidden). Amend before Chunk 6, not after

### Conventions worth promoting to the folder context files

- [ ] **`DB_CONTEXT.md`** — D1/D4's rule: *a table whose existence encodes an opt-in beats nullable
      columns that encode it by convention; split when a column is inapplicable to some rows, not
      merely unset on some rows*
- [ ] **`DB_CONTEXT.md`** — the ownership rule: *no domain table takes its scope from a user.*
      `household_id` is what every query filters on; user columns are attribution and visibility only
- [ ] **`API_CONTEXT.md`** — the visibility filter belongs in the repository layer, expressed once
