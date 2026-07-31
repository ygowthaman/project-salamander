# Inventory Context

Working context for the **inventory module** — the tracker for building it across multiple sessions.

**How to use this file.** It has three jobs, in this order:

1. **Spec digest** — what inventory has to be, gathered from [`PRD.md`](../PRD.md),
   [`ARCHITECTURE.md`](../ARCHITECTURE.md) and [`ROADMAP.md`](../ROADMAP.md) so a session does not
   have to re-derive it. Section refs point back to the authority; where this file and those
   disagree, **they win and this file is stale — fix it**.
2. **Plan** — the work cut into small chunks, each independently shippable.
3. **State** — what is done, what is next, and every design decision taken while building, with the
   reason. Update the *Status* and *Decision log* sections at the end of each session; that is what
   makes the next one resumable.

This file tracks *the build*. Durable "why this folder is shaped this way" reasoning still belongs in
the folder `*_CONTEXT.md` files (`node-server/src/db/DB_CONTEXT.md`, `src/api/API_CONTEXT.md`,
`src/agent/AGENT_CONTEXT.md`) — promote it there as each chunk lands, rather than letting this file
become the only place it lives.

---

## 1. What the inventory module is

An `inventory_item` is **anything the user tracks** — a grocery, printer ink, a book — classified by
a user-defined category it references via `category_id` (PRD §5.1). Two things follow that shape the
whole module:

- **Reorder is opt-in, and it lives entirely in `mandates`.** `inventory_items` knows nothing about
  reordering: no `par_level`, no `restock_level`, no mandate reference. One **`mandates`** row per item
  (`UNIQUE (inventory_item_id)`) carries the levels *and* the buying rule, and **the existence of that
  row is the opt-in signal**. A user can keep a **track-only** catalog (books they own) and never enter
  the reorder flow. Track-only mode must be fully usable on its own — that is an acceptance criterion
  (PRD §11), not a side effect. This diverges from PRD §6 — see [§2](#2-target-data-model) and
  decisions [D1](#7-decision-log) and [D4](#d4--reorder_configs-is-folded-into-mandates-one-row-per-item).
- **Natural language is the primary interaction.** Nobody types "6" into an egg-count field daily.
  They type *"low on eggs and milk, out of bread, still plenty of rice"* once a week and the LLM
  turns it into concrete numbers. Precise CRUD exists as the safety net, not the main path.

Inventory is also the module that **establishes the interpret pattern every later NL surface
reuses** (ROADMAP §1c). Getting the layering right here matters more than getting it done fast:
prompt + schema in `src/agent/`, validation at the route, `user_id` bound server-side.

### Commit pattern — direct commit (locked)

Inventory adds and stock updates write straight through: `interpret → validate → persist → WS push →
UI refresh`. No draft, no approval gate (PRD §5.0, §5.1; ROADMAP Phase 1 decisions).

Why: it is the everyday interaction, and a misread costs exactly one correcting sentence (*"no, 2
eggs not 12"*) or a precise `/inventory/{id}/adjust`. The UI still shows the interpretation as a
per-item old→new diff — **after** the write, not as a gate before it.

What direct commit does **not** remove: the zod validation gate. A failed or low-confidence
interpretation persists **nothing** (PRD §8.1). That is the only thing standing between a bad parse
and the database, so it is never optional.

### Invariants (do not negotiate these away mid-build)

- Every LLM call is **single-turn, non-streaming, stateless**, structured output via tool use. No
  message history, no persona, no streaming.
- **Never return model prose to the user.** The server decides what the UI shows.
- **Validate the model's output with the same zod schema the route uses.**
- **`user_id` is bound server-side** from the auth session — never from a model response or a request
  body. Cross-user `{id}` access is **404, not 403**.
- **The WS channel is per-user, server→client, best-effort.** REST is the source of truth; a dropped
  socket means stale, not broken. No write's correctness may depend on a push landing.
- **Anything the app joins on is its own table and the model returns its id.** `category` is a table;
  `unit` stays free text (nothing joins on it, drift never escapes the row).
- **Item names are surfaced, never invented. Categories are created, not surfaced.** The asymmetry is
  deliberate (PRD §5.1.1): inventing a category is cheap, visible on the categories page, and undone
  by a rename; inventing an item corrupts what the user believes they own.
- **Never hold a transaction across an LLM call.** Read context in a short transaction, call Claude
  with none open, write in another.

---

## 2. Target data model

From PRD §6, following the conventions in `DB_CONTEXT.md` (app-generated `crypto.randomUUID` PKs,
`user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, indexed `(user_id, …)`).

> **This model diverges from PRD §6 deliberately, and this file is the operative version.**
> `par_level` and `restock_level` have been moved off `inventory_items` into `mandates`, one row per
> item (decisions **D1** + **D4**). PRD §6, §5.1, §11 and §12.23, plus `ARCHITECTURE.md` →
> *Data model*, still describe them as item columns and are **stale on this point**. Reconciling them
> is deliberately deferred to one pass after inventory ships (**D2**) — so build against the model
> below, not the PRD's, and log any further divergence in the
> [§8 drift ledger](#8-design-drift-ledger).

```sql
categories                     -- user-defined taxonomy, curated from its own UI page (§5.1.1)
  id, user_id → users(id) ON DELETE CASCADE, name, created_at, updated_at
  -- UNIQUE (user_id, lower(name))  ← case-insensitive; a second "groceries" is a 409, not a row
  -- referenced by inventory_items.category_id and (later) budgets.category_id, both RESTRICT

inventory_items                -- EVERY tracked thing, in its complete form. No reorder columns.
  id, user_id → users(id) ON DELETE CASCADE, name,
  category_id → categories(id) ON DELETE RESTRICT,     -- NOT NULL
  unit (nullable),                                     -- free text, deliberately
  quantity (nullable),      -- "how many do I have" — universal; a book collection counts copies
  attributes (jsonb, nullable),  -- freeform: author/edition/isbn, model number — feeds NL search
  created_at, last_updated

inventory_events               -- audit trail; one row per applied stock change
  id, user_id → users(id) ON DELETE CASCADE,
  inventory_item_id → inventory_items(id) ON DELETE CASCADE,
  delta, new_stock, reason, created_at
  -- `reason` holds the user's ORIGINAL PHRASE for interpreted writes (§5.1)
```

And the reorder side — **not part of the inventory module**, listed here only because it owns the two
columns that used to sit on the item and because the interpreter reads it (D1, D4):

```sql
mandates                       -- ONE ROW PER REORDERABLE ITEM. ITS EXISTENCE IS THE OPT-IN.
  id, user_id → users(id) ON DELETE CASCADE,
  inventory_item_id → inventory_items(id) ON DELETE CASCADE,
  -- levels: what "normal" and "full" mean for this item (were reorder_configs, D4)
  par_level,                     -- NOT NULL: the quantity to keep on hand. Opting in without a par
                                 --   is meaningless, so it can be required.
  restock_level (nullable),      -- the resulting stock target when a reorder is PLACED (§5.9).
                                 --   eggs → 12, bread → 1. Falls back to par_level (§12.23).
  -- the buying rule: nullable until the NL mandate interpreter ships in Phase 2
  trigger_condition (nullable),  -- structured {op, field, value}, e.g. stock < 2 (locked, §12)
  shopping_query (nullable),     -- WHAT to buy, which may differ from the item (§5.2) and carries
                                 --   its own quantity/packaging — "2 × 2L whole milk" (D4, case 4)
  grant_id (nullable → grants(id) ON DELETE SET NULL),
  preferred_product (jsonb, nullable),   -- last product chosen; reused to stabilize matching (§5.10)
  created_at, updated_at
  -- UNIQUE (inventory_item_id) — ONE rule per item (D4). Changing your mind is an UPDATE.
  -- INDEX (user_id)
  -- CASCADE from the item: deleting an item takes its rule with it.
  -- NOTE: PRD §6 has neither the levels nor the UNIQUE, and has an `active` bool this drops (D4).
```

Notes that are easy to get wrong:

- **The item table is what the split protects, and that survives D4.** A DVD and a carton of eggs are
  both fully-described `inventory_items` rows; neither carries a column that does not apply to it.
  "Is this reorderable?" is not *"are these two nullable columns filled in?"* — an encoding that can be
  half-filled and has no single answer — but *"does a `mandates` row exist?"*, one boolean the database
  enforces.
- **Nullable on `mandates` means "not yet supplied", never "inapplicable".** That distinction is the
  whole reason D1 moved these columns in the first place, so it has to hold on the merged table: every
  row is a reorderable item, so par/restock always apply; a null `trigger_condition` is an item opted
  in before its rule was written, and a null `grant_id` is a rule with no stated constraint
  (PRD §5.2). If a column ever appears that is *inapplicable* for some rows, that is the signal to
  split again.
- **`quantity` stays on the item.** It is universal — you can own 1 copy of a book — and NL
  search filters on it (*"am I low on…"*, PRD §5.8). Stock updates must therefore work on items with
  no `mandates` row at all.
- **`mandates` is the reorder hub, not inventory.** Grants, budgets, windows and runs connect *there*;
  the inventory module has no outbound dependency on any of them, and nothing in Chunks 1–2 may read
  this table.
- `user_id` on `mandates` is denormalized from the item, following the convention every user-owned
  table uses. It must be written from the item's owner, never from a request body.
- All quantity fields are stored **in the item's base unit**. The LLM normalizes on the way in
  (*"a dozen"* → `12`, *"a loaf"* → `1`).
- The **qualitative word is never persisted** as data — only as the audit `reason`.
- `category_id` is NOT NULL, which makes `categories` a hard prerequisite. Retrofitting the FK onto
  existing items is the painful version, so the table is paid for up front (ROADMAP Phase 1
  decisions).
- Numeric type for stock levels is still open — see [Open decisions](#5-open-decisions-that-touch-inventory).

---

## 3. Target API surface

From PRD §7. Every route requires auth; ownership is enforced per `{id}`.

```
# Categories (§5.1.1) — plain CRUD backing a management page. No LLM, no /parse.
GET    /categories                  -- list, each with its item count
POST   /categories      { name }    -- unique per user, case-insensitive → 409 on duplicate
PATCH  /categories/{id} { name }    -- rename; items/budgets follow the id, not the name
DELETE /categories/{id}             -- 409 + item count if items still reference it (RESTRICT)

# Inventory — natural language first (DIRECT COMMIT), precise routes as the safety net
POST             /inventory/interpret { text }   -- interpret → validate → COMMIT in one call.
                                                 --   Returns applied per-item old→new changes plus
                                                 --   unresolved names. Writes inventory_events
                                                 --   (reason = original phrase) and pushes on WS.
GET              /inventory                      -- list
GET/PATCH/DELETE /inventory/{id}                 -- precise manual edits
POST             /inventory/{id}/adjust { delta | absolute, reason? }
POST             /inventory/search    { text }   -- read-only NL search (§5.8) — PHASE 2, not now
```

### The interpret flow (the shape to implement)

Identical to `API_CONTEXT.md` → *The interpret flow*; inventory is the module that first realizes it:

```
1. Parse the body with zod                { text: "low on eggs, out of bread" }
2. Assemble context from the DB           item names + ids; per named item quantity + unit,
                                          plus par_level (and later trigger_condition) LEFT JOINed
                                          from mandates — absent for track-only items;
                                          categories as {id, name} pairs
3. Call the agent-layer interpreter       single-turn tool use → structured JSON
4. Validate with the SAME zod schema      invalid / low-confidence / unresolved → 422, nothing written
5. Commit in one transaction              item rows + inventory_events together
6. Push on the user's WS channel          inventory.upserted / inventory.deleted
7. Respond with the applied old→new diff  so the UI clears the input and shows what it did
```

Two interpretation **targets** live behind `/inventory/interpret` (PRD §8.1):

| Target | Input example | Output |
|---|---|---|
| Stock update | *"low on eggs and milk, out of bread"* | per-item `quantity` changes, threshold-aware |
| Item definition | *"Add 1984 to my Books"*, *"start tracking eggs, a dozen is normal"* | new `inventory_items` rows, category resolved to `category_id` **or** proposed `new_category` |

Threshold-aware mapping (PRD §5.1) — the crux of the stock-update target:

- *"out of eggs"* → `0`
- *"low on eggs"* → at/below the reorder threshold, so the mandate fires next run (par 6, trigger
  `stock < 2` → set `1`)
- *"restocked / plenty"* → at or above `par_level`
- a stated number (*"2 eggs left"*) → verbatim
- *"a dozen eggs"* → `12` (unit normalization, same target)

**With the reorder split (D1), an item may have no `par_level` to anchor against** — a track-only book
has no `mandates` row by design. So the interpreter always needs **two bands**, permanently, not as a
phase workaround (§12.14, resolved):

- **Anchored** (a `mandates` row exists) — map against `par_level` now, against `trigger_condition`
  once that column is populated in Phase 2. This is the PRD §5.1 behaviour.
- **Unanchored** (no row) — *"low"/"out"* still set a small/zero count and *"plenty"* a nominal
  restock, written directly and left editable in the table. Nothing fires off these numbers, because
  an item with no mandate has nothing to trigger.

Chunk 2b ships the anchored path in Phase 1 (D3), so both bands are exercised from the start.

One sentence updates **many items at once**. Unresolved item names come back in the response for the
user to add — never silently created.

Category resolution returns **exactly one of** `category_id` or `new_category`, never a bare string:

```jsonc
{ "name": "Eggs", "category_id": "c1",     "unit": "each", "quantity": 12 }  // existing
{ "name": "1984", "new_category": "Books", "unit": "each", "quantity": 1  }  // created in-txn
```

### WS events this module emits

Typed data events, not text (ARCHITECTURE → *The WebSocket push channel*):

```jsonc
{ "type": "inventory.upserted", "items": [ { "id": "…", "name": "1984", … } ] }
{ "type": "inventory.deleted",  "ids": ["…"] }
{ "type": "category.upserted",  "categories": [ … ] }
{ "type": "category.deleted",   "ids": ["…"] }
```

---

## 4. Plan — chunked

Chunks are ordered by dependency and sized so each one leaves the app working. Ordering follows
ROADMAP Phase 1b → 1c. Nothing here is committed to until its chunk starts; refine freely as the
build teaches us things, and record the refinement in the [Decision log](#7-decision-log).

Status key: `[ ]` not started · `[~]` in progress · `[x]` done

### Chunk 0 — preconditions (verified 2026-07-28)

Checked against the code, not the docs. **The backend needs no new dependencies**: `zod`,
`drizzle-orm`, `drizzle-kit`, `pg`, `@anthropic-ai/sdk` (^0.68.0) and `@fastify/websocket` (^8.3.1)
are all already installed, and `@fastify/websocket` is registered in `app.ts` with no route.

Two things must be dealt with before or during Chunk 1:

- [ ] **Apply the migrations against a live local Postgres.** `0001_auth_users_oauth.sql` has never
      run anywhere (ARCHITECTURE → Known gaps), so Chunk 1's first act — `npm run db:migrate` — is
      also the first real test of the migration path. Verify it before stacking new migrations on it.
- [ ] **Decide the test lane for database behaviour.** `npm test` is a hand-rolled `tsx` script using
      `app.inject()` and is **deliberately database-free**; it fakes `DATABASE_URL`. But Chunks 1–2 are
      almost entirely DB behaviour — the case-insensitive unique index, `ON DELETE RESTRICT`, cascade.
      Either add a DB-backed lane (`npm run test:db` against a local Postgres) or accept manual
      verification and say so. There is no test framework installed; the existing idiom is a plain
      script with a `check()` helper, which is fine to follow.

Route registration note: new route plugins go in **`app.ts`** (`server.ts` only binds the port and runs
migrations). `API_CONTEXT.md` currently says `server.ts` — that is wrong, and it is in the §8 ledger.

### Chunk 1 — `categories` backend
_ROADMAP 1b; PRD §5.1.1_

- [ ] `categories` table in `db/schema.ts`; `npm run db:generate`, commit the generated SQL
- [ ] `UNIQUE (user_id, lower(name))` — needs a raw expression index, not a plain `uniqueIndex`
- [ ] `db/repositories/categories.ts` — user-scoped only (`…ForUser`), takes a `DbExecutor`
- [ ] `api/categories.ts` — `GET` (with item counts) / `POST` / `PATCH` / `DELETE`, registered in
      `server.ts`
- [ ] 409 on duplicate name (case-insensitive); 409 + **item count** on delete-with-items
- [ ] Tests: uniqueness, delete-restrict, cross-user 404

### Chunk 2 — `inventory_items` + `inventory_events` backend CRUD
_ROADMAP 1b; PRD §5.1 precise path_

- [ ] Both tables in `schema.ts` + migration — **no `par_level`, no `restock_level`** (D1)
- [ ] `db/repositories/inventoryItems.ts`, `db/repositories/inventoryEvents.ts`
- [ ] `api/inventory.ts` — `GET /inventory`, `GET/PATCH/DELETE /inventory/{id}`,
      `POST /inventory/{id}/adjust` (absolute / delta), writing an `inventory_events` row per change
- [ ] `POST /inventory` (structured create) — the precise path; the NL path lands in Chunk 5
- [ ] Tests: user scoping, adjust arithmetic, event rows written, track-only items (null stock/unit),
      and that nothing in this chunk imports or assumes anything reorder-related

### Chunk 2b — `mandates`, levels only
_Pulled into Phase 1 (D3) so the stock interpreter has a real anchor; merged table per D4_

The `mandates` table with its **levels half only** — `par_level`, `restock_level`, and the opt-in — so
*"low on eggs"* has a real threshold to land under. The rule half (`trigger_condition`,
`shopping_query`, `grant_id`, `preferred_product`) stays null until Phase 2 fills it via the NL mandate
interpreter. Grants, budgets, windows and runs are untouched here.

- [ ] `mandates` table + migration: `UNIQUE (inventory_item_id)`, CASCADE from the item, the rule
      columns present but nullable — **create them now, not in a Phase 2 migration**, so the table
      shape is settled and Phase 2 only writes to it. **Exception: `grant_id` is deferred**, because
      its FK target `grants` does not exist and pulling that table into Phase 1 would add a table with
      no Phase 1 consumer. Adding one nullable FK column in Phase 2 is purely additive — it reshapes
      nothing — so it does not conflict with "nothing temporary".
- [ ] `db/repositories/mandates.ts` + `GET/PUT/DELETE /inventory/{id}/reorder` (route prefix is still
      open — see §5)
- [ ] UI: an "enable reorder" toggle on an item, with par / restock fields
- [ ] The item list surfaces reorder-enabled items **without inventory code reading `mandates`
      itself** — the read goes through the reorder repository/routes, so D1's separation holds in the
      code and not just the schema
- [ ] Tests: opt-in and opt-out, `UNIQUE` rejects a second rule for one item, cascade on item delete,
      and that a stock update still works on an item with no mandate row

### Chunk 3 — WebSocket push channel
_ROADMAP Phase 1 decisions; ARCHITECTURE → push channel_

- [ ] `api/websocket.ts` — attach a route to the already-registered `@fastify/websocket`
- [ ] Auth **at the handshake** (cookie rides the upgrade) + `Origin` check (CORS does not apply)
- [ ] Channel derived server-side from the session user id — the client never names it
- [ ] Server→client only; a per-user registry with a `publish(userId, event)` used by routes
- [ ] Re-check ownership per push: a socket outlives the 15-min access token
- [ ] Wire Chunk 1–2 writes to emit their events
- [ ] Frontend: WS client **with reconnect** (capped backoff, visible "reconnecting", re-fetch on
      reconnect) — this is a known gap inherited from the deleted chat hook; close it deliberately

### Chunk 4 — frontend: categories page + inventory table
_ROADMAP 1b_

- [ ] **Routing.** `App.tsx` is currently a binary gate (`authenticated ? HomePage : LoginPage`) and
      there is **no router installed**. Inventory + categories are separate pages, so this chunk needs
      either `react-router-dom` (deep links, back button — recommended) or a hand-rolled view-state
      switch (zero deps, no URLs). This is the module's only genuinely new dependency — see §5.
- [x] **Styling convention — settled.** Tailwind has been removed. The app uses **Mantine**
      (`@mantine/core` + `@mantine/hooks`, themed in `src/theme.ts`) with **Tabler** icons
      (`@tabler/icons-react`). Build components out of Mantine primitives and reach for its `Table`,
      `Select` and form inputs on the new pages. Mantine's own props (`gap`, `px`, `fw`, `c`, `maw`)
      are the component API — use them freely. Anything beyond them goes in a sibling
      `*.module.css`; **no inline `style={{…}}` objects.**
- [ ] Categories management page: list with item counts, create / rename / delete (a **form**, not NL)
- [ ] Inventory list view + create/edit form, category as a **picker over the user's own categories**
- [ ] Live updates from the WS channel
- [ ] Track-only mode is genuinely usable at the end of this chunk — that is the milestone

### Chunk 5 — stock-update interpreter
_ROADMAP 1c; PRD §8.1_

- [ ] `agent/` first real function: prompt + tool schema for the stock-update target
- [ ] Shared zod schema used by both the agent layer and the route
- [ ] Threshold-aware mapping + unit normalization
- [ ] `POST /inventory/interpret` — context assembly, validate, commit in one transaction
      (items + events), push, respond with the old→new diff
- [ ] Unresolved names surfaced in the response, never created
- [ ] 422 with the partial parse on low-confidence/unparseable input
- [ ] Timeout + one bounded retry on transient errors; clean user-facing failure, never a 500
- [ ] `cache_control: { type: "ephemeral" }` on the static prefix; **verify
      `usage.cache_read_input_tokens` is non-zero** rather than assuming
- [ ] Log tokens / latency / model per call
- [ ] Frontend: the NL input box, clearing on success, showing the per-item diff after the write

### Chunk 6 — item-definition interpreter
_PRD §5.1, §5.1.1_

- [ ] Second agent function/target: text → new `inventory_items`, inferring `unit` and
      `quantity`
- [ ] Category resolution returning `category_id` **xor** `new_category` (enforce the xor in zod)
- [ ] *"start tracking eggs, a dozen is normal"* also infers `par_level` / `restock_level` and creates
      the `mandates` row **in the same transaction** as the item (Chunk 2b ships the table, so this
      path is live)
- [ ] Decide how the interpreter judges an item reorderable at all — *"add 1984 to my Books"* must
      **not** produce a config row, *"start tracking eggs"* probably should (§12.15)
- [ ] Server creates a proposed category **inside the same commit transaction** as the item
- [ ] Decide whether this shares `/inventory/interpret` with the stock-update target or gets its own
      route — see [Open decisions](#5-open-decisions-that-touch-inventory)

### Chunk 7 — golden eval set + cost logging
_ROADMAP 1c; PRD §8.3_

- [ ] Scripted golden set for the inventory interpreters, runnable as a regression gate
- [ ] Cases: multi-item sentences, qualitative bands, unit expressions, unresolved names, new
      category proposals, adversarial/ambiguous input
- [ ] Token/latency/model logging surfaced somewhere readable

### Chunk 8 — reconcile the authoritative docs
_D2: one pass at the end, not per-chunk_

- [ ] Work the [§8 drift ledger](#8-design-drift-ledger) top to bottom: PRD, ARCHITECTURE, ROADMAP,
      the folder `*_CONTEXT.md` files, CLAUDE.md
- [ ] Promote the durable "why" from this file into the folder context files; leave the build history
      (§4 checkboxes, §6 log) here
- [ ] Re-read the ledger against the shipped schema and routes — anything the code does that no doc
      describes is drift too, not just the entries logged along the way
- [ ] Empty the ledger; whatever survives becomes a real open item, not a pending edit

**Explicitly out of scope for now:** `POST /inventory/search` (Phase 2), grants / budgets, the **NL
mandate interpreter and the rule half of `mandates`** (Phase 2 — Chunk 2b ships the levels only), the
**reorder module proper** (windows, runs, and the grant/budget wiring), the reorder-window auto-trigger
on stock update (PRD §5.1 last paragraph — needs `reorder_windows`), setting stock to `restock_level` on
cart placement (Phase 3), and **any pause/resume mechanism** (D4 — out of scope by decision, not
oversight).

---

## 5. Open decisions that touch inventory

PRD §12 items this module has to answer, plus ones the build will raise. Record the answer here when
it is made, with the reason, and mirror it into the PRD if it settles a §12 entry.

| # | Decision | Assumed default | State |
|---|---|---|---|
| §12.14 | Qualitative→quantitative anchor for *"low"* / *"plenty"* | Relative to the item's **mandate trigger threshold**, so *"low"* reliably fires the reorder | **Resolved (D3):** two permanent bands — anchored on `mandates.par_level` (`trigger_condition` supersedes it once populated in Phase 2), unanchored otherwise. Chunk 2b ships the anchored path in Phase 1. See §3. |
| §12.15 | How much to infer for a new item named in a stock sentence | Infer sensible defaults (unit, category, par) and leave them editable rather than blocking | Open — and D1/D4 split it in two writes: inferring `unit`/`category` writes the item, inferring `par`/`restock` writes a `mandates` row. Decide at Chunk 6 whether one sentence may create both, and how the interpreter decides an item is reorderable at all. |
| §12.21 | `attributes` shape | Fully freeform per-item `jsonb` | Open; deferrable until search recall demands conventions |
| §12.24 | Category seeding for a new account | Start empty; first categories come from the page or the interpreter | Open |
| §12.20 | Search matching depth (`ILIKE` → `pg_trgm` → full-text) | `ILIKE` over name + `attributes` | Open — Phase 2, but `attributes` shape now constrains it |
| §12.23 | `restock_level` fallback when unset | `par_level`, else the ordered quantity | Open — matters in Phase 3. Cheaper now: both columns sit on the same row, so the fallback is local rather than a cross-table lookup |
| new | One `/inventory/interpret` route for both targets, or a route per target? | Single route; the interpreter classifies. PRD §7 lists one route. | Open — decide at Chunk 6 |
| new | Numeric type for `quantity` / `par_level` / `restock_level` | `numeric` — *"half a bag of rice"* is a stated fractional case (§5.1) | Open — decide at Chunk 2; note `numeric` comes back as a string in `pg` |
| ~~new (D1)~~ | ~~Table name for the reorder policy table~~ | — | **Moot (D4):** there is no separate table; it is `mandates` |
| ~~new (D1)~~ | ~~Does `mandates` key on `reorder_config_id` or `inventory_item_id`?~~ | — | **Moot (D4):** one merged table keyed on `inventory_item_id`, `UNIQUE` |
| new (D1) | Does anything in the inventory UI need to *show* reorder state? | Yes, read-only — a badge/toggle — fetched from the reorder routes, never by inventory reading `mandates` itself | Open — decide at Chunk 4 / 2b |
| new (D4) | Route prefix for the levels/rule surface | `/inventory/{id}/reorder` reads naturally but puts a reorder route under the inventory namespace, cutting against the separation; `/mandates/{item_id}` matches PRD §7 | Open — decide at Chunk 2b |
| new (D4) | Is `restock_level` a scalar target, or something richer? | Scalar (the resulting stock target), with expressiveness living in `shopping_query` instead — *"2 × 2L whole milk"* is what to buy, `4` is what full means | Assumed per D4 case 4; revisit if a real case needs structure. `jsonb` is available but PRD reserves it for genuinely open-ended fields |
| new | Frontend routing: `react-router-dom` vs a hand-rolled view switch | `react-router-dom` — categories / inventory / search / settings are all coming, and deep links plus the back button matter for a table-driven app | Open — decide at Chunk 4. The only new dependency the module needs; the backend needs none. |
| new | Test lane for DB behaviour (unique index, RESTRICT, cascade) | A second script (`test:db`) against a local Postgres, following the existing `check()` idiom | Open — decide at Chunk 1; `npm test` is deliberately DB-free and cannot cover these |
| new (D4) | Drop `mandates.active`? | Yes — with pause/resume out of scope, no consumer remains; pausing is "set stock above restock" | Assumed; the column is cheap to re-add, and its absence is a PRD §6 divergence to log |

---

## 6. Status

**Nothing in this module is built yet.** As of the first session on this file (2026-07-28):

- Schema holds only the three auth tables (`users`, `oauth_accounts`, `auth_sessions`). No
  `categories`, no `inventory_items`, no `inventory_events`.
- `node-server/src/api/inventory.ts` exists but is **empty** — an untracked placeholder, not code.
- `node-server/src/agent/` has **no code at all**; the chat generator was deleted, not refactored.
- `@fastify/websocket` is registered in `app.ts` with **no route attached** — deliberately kept for
  this channel.
- The frontend is the login screen plus a placeholder signed-in shell. No WS client.
- Migrations `0000`–`0002` applied; `0001` has never run against a live Postgres (ARCHITECTURE →
  Known gaps).

**Next up:** Chunk 0 preconditions (apply migrations against a live local Postgres; pick the DB test
lane), then Chunk 1 — `categories` backend.

**Self-containment check (2026-07-28).** The backend half of this module can be built with nothing
pulled in: every dependency is installed and `categories` + the `mandates` levels half are inside the
plan by decision (D3/D4). The exceptions are all recorded above — `grant_id` deferred to Phase 2,
frontend routing at Chunk 4, and a DB test lane at Chunk 1.

### Session log

Append one entry per session: what shipped, what changed in the plan, where the next session starts.

- **2026-07-28** — Created this file. No code written. Spec digested from PRD §5.0/§5.1/§5.1.1/§6/§7/
  §8.1/§11/§12, ARCHITECTURE (data model, interpret flow, push channel, known gaps), ROADMAP Phase 1.
  Plan cut into chunks, then three decisions taken before any code: **D1** reorder split (revised
  §1–§3 and Chunk 2/6), **D2** defer all authoritative-doc updates to a single Chunk 8 pass, **D3**
  reorder levels ship in Phase 1 as Chunk 2b (resolves §12.14), **D4** fold the levels table into
  `mandates` with `UNIQUE (inventory_item_id)` — one rule per item, `active` dropped, pause/resume out
  of scope. D4 revises D1's structure but keeps its rationale: `inventory_items` still holds no reorder
  columns. The docs now diverge from this file on purpose — §8 is the ledger.

---

## 7. Decision log

Design decisions taken **while building** — the ones not already in the PRD. Each: what, why, and
what it would cost to reverse. Keep it append-only; supersede an entry rather than editing it away.

### D1 — `par_level` and `restock_level` move off `inventory_items` into `reorder_configs`
_2026-07-28 · maintainer · supersedes PRD §6's item columns_
> **Structure revised by [D4](#d4--reorder_configs-is-folded-into-mandates-one-row-per-item):** there is
> no `reorder_configs` table — the columns live on `mandates`. The reasoning below still governs, and
> D1's outcome for `inventory_items` (no reorder columns) is unchanged. Kept as written for the record.

**What.** `inventory_items` carries no reorder fields at all. A separate `reorder_configs` table holds
`par_level` (NOT NULL) and `restock_level` (nullable), one optional row per item
(`UNIQUE (inventory_item_id)`, `ON DELETE CASCADE`). **The row's existence is the opt-in.** The
inventory module has no knowledge of reordering; the reorder module is where inventory, mandates,
grants and budgets get connected.

**Why.** Under PRD §6, a reorderable grocery and a one-time purchase like a book or a DVD share a
table where two columns are "not applicable" for one of them. That has three costs the split removes:

1. **Neither row is complete.** Every consumer has to know that `par_level IS NULL` means
   *not-a-reorder-item* rather than *not-yet-set* — two genuinely different states the encoding cannot
   distinguish, and nothing stops a half-filled pair (`par` set, `restock` null, meaning what?).
2. **Opt-in becomes checkable.** *"Is this reorderable?"* goes from a nullability convention spread
   across route, agent and UI code to one FK the database enforces, and the columns that are always
   meaningful inside that row can finally be NOT NULL.
3. **The dependency points the right way.** Inventory is the base table everything else hangs off. It
   should not carry columns that exist only to serve a module built two phases later — and it now
   doesn't, so Chunk 2 ships with no forward reference to anything unbuilt.

**Cost to reverse.** Low while unbuilt, and it stays low: folding the columns back means one migration
adding two nullable columns plus a copy-across. The reverse direction — the one we avoided — is the
expensive one, since splitting after items exist means backfilling and rewriting every reader.

**Consequences already recorded.** `quantity` stays on the item (universal, and search filters on
it). The stock interpreter permanently needs an unanchored band for items with no config (§12.14, D3).
`restock_level`'s §12.23 fallback is now same-row. Whether `mandates` re-keys onto `reorder_config_id`
is the reorder module's call (§5).

### D2 — the authoritative docs are reconciled once, after inventory ships
_2026-07-28 · maintainer_

**What.** PRD, ARCHITECTURE and ROADMAP are **not** updated as each decision lands. Design changes
accumulate in the [§8 drift ledger](#8-design-drift-ledger) and are applied in one pass (Chunk 8).

**Why.** Inventory is expected to keep refining as it is built, so per-decision doc edits would mean
rewriting the same PRD sections repeatedly, each time with less confidence that the wording is final.
One pass over a complete ledger is cheaper and lands more coherent prose than eight partial passes.

**What this costs, and the mitigation.** Until Chunk 8, `CLAUDE.md`'s *"the docs are the spec"* is
**temporarily false for inventory** — PRD §6 describes a schema we have deliberately abandoned. That
is a real hazard for a session that reads the PRD and not this file. Mitigations, both mandatory:

1. **Every superseding decision gets a ledger entry the moment it is taken** — an unlogged decision is
   how the drift becomes unrecoverable, because nobody can reconstruct it from the code later.
2. **§2 carries an explicit divergence banner** pointing here, so the target model in this file is
   visibly the operative one.

### D3 — the reorder levels ship in Phase 1 (Chunk 2b); rules, grants and windows do not
_2026-07-28 · maintainer · written before D4, when the levels had their own table_
> **Read `reorder_configs` below as "the levels half of `mandates`" (D4).** What ships in Phase 1 is
> unchanged: par, restock, and the opt-in.

**What.** The two-column table, its repository, `GET/PUT/DELETE /inventory/{id}/reorder`, and a UI
opt-in toggle land right after inventory CRUD. Everything else in the reorder module stays in its
later phase.

**Why.** D1 moved `par_level` out of `inventory_items`, which left the Phase 1 stock interpreter with
nothing to anchor *"low"* against — and threshold-aware mapping is a Phase 1c acceptance criterion
(PRD §11), so deferring the table would have made a Phase 1 deliverable untestable until Phase 2. Two
columns and four routes is a small price to keep the phase's headline feature verifiable, and it means
the eval set (Chunk 7) covers the anchored path from the start rather than being retrofitted.

**Consequence.** §12.14 is resolved: two bands, anchored and unanchored, permanently — the unanchored
one is not a Phase 1 stopgap, it is what a book or DVD gets forever.

### D4 — `reorder_configs` is folded into `mandates`, one row per item
_2026-07-28 · maintainer · revises D1's structure, keeps its rationale_

**What.** No separate levels table. `mandates` holds `par_level` and `restock_level` alongside
`trigger_condition`, `shopping_query`, `grant_id` and `preferred_product`, with
**`UNIQUE (inventory_item_id)`** — one rule per item. `active` is dropped. `inventory_items` still
carries nothing about reordering.

**Why — one rule per item is the load-bearing part.** Multiple mandates per item was the only argument
that made two tables structurally necessary: sibling rules would each need par/restock, so the levels
had to live somewhere they could not be duplicated or contradicted. With 1:1, that pressure disappears
— and more importantly, several rules per item complicates evaluation for no user benefit: the
scheduler would need precedence between them, and the user would have to reason about which one fired.
**Changing a rule is an UPDATE, not a second row.**

The three remaining cases for a split all reduce to "put another field on the one table":

- *Levels without a rule* — a row with `trigger_condition` null. A real, permanent state (opted in,
  rule not written yet), not a Phase 1 stopgap: the column arrives in Chunk 2b and Phase 2 populates
  it, so nothing is built temporarily.
- *Pausing a rule* — **out of scope by decision.** Automated pause/resume means deciding when it
  resumes, what happens to an open window, and how it interacts with the schedule. Raising stock above
  `restock_level` suppresses the trigger with no new machinery.
- *Purchase quantity ≠ restock level* — two fields, not two tables. `restock_level` is the resulting
  stock target (`4` litres); `shopping_query` carries what to actually buy (*"2 × 2L whole milk"*) and
  can be as expressive as the rule needs, which a scalar column never could.

**What survives from D1, and why that matters.** D1's content was *get reorder columns off
`inventory_items`* so a book and a carton of eggs are both complete rows. That holds unchanged. What
D4 revises is only how the reorder side divides internally. The invariant D1 established still governs
the merged table: **nullable means "not yet supplied", never "inapplicable"** — every `mandates` row is
a reorderable item, so par/restock always apply. If a column ever shows up that is inapplicable for
some rows, split again.

**Cost to reverse.** Low and symmetric while unbuilt. Splitting later means a new table plus a
copy-across of two columns; the `UNIQUE` constraint is what would have to be dropped first, and that is
the decision worth revisiting if a real multi-rule case appears (e.g. genuinely different behaviour at
"running low" vs "completely out"). Nothing else depends on the split.

**Known cost accepted.** Pausing by raising stock records a stock level the user does not physically
have, so `inventory_events` shows a change that never happened. Acceptable while pause is out of scope;
if pause becomes a feature, it gets a real mechanism rather than this workaround.

---

## 8. Design drift ledger

**Append-only.** Every decision that supersedes `PRD.md`, `ARCHITECTURE.md` or `ROADMAP.md` gets an
entry here **when it is taken** — see D2 for why this is the load-bearing habit rather than
bookkeeping. Chunk 8 works the list and empties it.

Until then, treat this section as the diff between the docs and reality.

**From D1 (reorder columns off the item) + D4 (merged into `mandates`):**

- [ ] **PRD §6 `inventory_items`** — remove `par_level` / `restock_level`
- [ ] **PRD §6 `mandates`** — add `par_level` (NOT NULL) + `restock_level`; add
      `UNIQUE (inventory_item_id)`; make `trigger_condition` / `shopping_query` nullable; **drop
      `active`**
- [ ] **PRD §5.1** — *"`par_level` and any mandate are optional per item"* and the **Item definitions**
      paragraph both describe par/restock as item fields
- [ ] **PRD §5.2** — record that a mandate is 1:1 with an item and that revising one is an UPDATE;
      note pause/resume is explicitly out of scope
- [ ] **PRD §11** — the track-only and `restock_level`-on-placement criteria assume item columns
- [ ] **PRD §12.23** — the `restock_level` fallback is now a same-row lookup
- [ ] **`ARCHITECTURE.md` → Data model** — the *"domain tables arrive with Phase 1b"* note points at
      PRD §6 as the target model
- [ ] **`ROADMAP.md` §1b** — lists `par_level` as an optional item field
- [ ] **`DB_CONTEXT.md`** — the "conventions for new tables" section is a good home for D1's rule:
      *a table whose existence encodes an opt-in beats nullable columns that encode it by convention*
- [ ] **`CLAUDE.md`** — no change needed; it never names the columns

**From D2 (deferred doc reconciliation):**

- [ ] Nothing to write in the docs — but Chunk 8 must verify no *other* drift crept in unlogged

**Pre-existing doc errors found while checking preconditions (not caused by any decision here):**

- [ ] **`API_CONTEXT.md` → "Adding a new endpoint"** says register the plugin in `server.ts`. Route
      plugins are registered in **`app.ts`**; `server.ts` only runs migrations and binds the port.
      Actively misleading for the next session, so worth fixing early rather than at Chunk 8.
- [x] **`CLAUDE.md` tech-stack table** listed Tailwind, which was configured but unused. Resolved:
      Tailwind is gone and the table now names Mantine + Tabler, which is what the components use.

**From D3 (reorder levels ship in Phase 1):**

- [ ] **PRD §12.14** — resolved; record the two-band answer
- [ ] **`ROADMAP.md` §1b/§1c** — Phase 1b gains the `mandates` table (levels only) + its routes + the
      opt-in toggle; 1c's threshold-aware mapping is anchored on par, with the unanchored band as
      specified behaviour rather than a gap. Note the table now spans two phases: levels in 1b, the
      rule half in Phase 2.
- [ ] **PRD §7** — add the levels/rule route (prefix still open, §5)

**From D4 (merge):**

- [ ] **`ROADMAP.md` Phase 2** — the mandate work becomes "populate the rule half of an existing
      table", not "create `mandates`"
- [ ] **`DB_CONTEXT.md`** — pair D1's rule with D4's corollary: *split when a column is inapplicable to
      some rows; do not split merely because it is unset on some rows*
