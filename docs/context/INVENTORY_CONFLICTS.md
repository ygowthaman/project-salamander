# Inventory — open conflicts

Every place the **inventory code** contradicts [`PRD.md`](../PRD.md) §2.5, and §2.2/§2.3 which it
depends on.

**How to use this file.** Load it into a session, pick one entry, fix exactly that entry, then delete
the entry from here. Each entry is self-contained: it names the file and line, what the code asserts,
what the spec requires, and what the fix is — so no session has to re-derive the disagreement. This
file is what is still wrong; git holds what was fixed. Entry ids are stable — the remaining entries
cite each other, so a deletion never renumbers them.

**`PRD.md` is authoritative.** Where code disagrees with it, the code is wrong. The exception is
marked **NEEDS A RULING** — there the PRD and the code disagree in a way whose answer is a decision,
not an edit.

Status key: `[ ]` open · `[~]` in progress

Entries sharing a **Batch** are one editing pass over one file; doing them together is cheaper than
doing them in order.

---

## NEEDS A RULING

### [ ] C10 — PRD §2.5.4 asserts controls that do not work
**Where:** [`InventoryItemCard.tsx:27-29`](../../frontend/src/components/inventory/InventoryItemCard.tsx#L27-L29),
[`InventoryPage.tsx:179-183`](../../frontend/src/components/inventory/InventoryPage.tsx#L179-L183)
**Code:** `onView` / `onEdit` / `onDelete` are optional props; `InventoryPage` passes none, so all
three buttons render and do nothing.
**Spec:** PRD §2.5.4 states *"The view, update and delete controls already exist in the interface;
the natural-language path below is the new work."* That sentence is false as written.
**The ruling:** the controls get wired — which needs the routes serving real data first — **or**
§2.5.4 stops claiming they exist. Flagged rather than silently fixed because it changes what the PRD
says the remaining work is.

---

## The NL path is still a one-shot parse, not an exchange

### [ ] C11 — `InterpretResult` has no room for a question
**Where:** [`frontend/src/api/inventory.ts:34-37`](../../frontend/src/api/inventory.ts#L34-L37) · **Batch:** FE-1
**Code:** `interface InterpretResult { summary: string }` — one field, always a committed result.
**Spec:** PRD §2.5.5–§2.5.7 — the model replies with **either a structured object or a question**,
and an unresolved sentence opens a clarification exchange capped at ten.
**Fix:** Make the response a discriminated union — a committed result, or a question carrying the
exchange id and the turn number. The exchange is ephemeral (§2.5.7): nothing about it is persisted
client-side beyond the life of the component.

### [ ] C12 — the client asserts there is no conversation
**Where:** [`frontend/src/api/inventory.ts:41-43`](../../frontend/src/api/inventory.ts#L41-L43) and
[`InventoryPage.tsx:32-34`](../../frontend/src/components/inventory/InventoryPage.tsx#L32-L34) · **Batch:** FE-1
**Code:** *"Direct commit: … there is no confirm step and **nothing conversational on either side**"*
and *"there is no transcript because **there is no conversation to keep**."*
**Spec:** §2.5.7 — clarification is a real exchange, and it is the only place model prose reaches the
user. Direct commit survives (the exchange is not an approval gate) but "nothing conversational" does
not.
**Fix:** Rewrite both comments to distinguish the two things they conflate: **no approval step**
(true, and the point of direct commit) from **no clarification turns** (false under §2.5.7). The
receipt line at [:119](../../frontend/src/components/inventory/InventoryPage.tsx#L119) needs to
render a pending question and the server-written ten-turn failure that points at the form.

---

## Gaps — specified, not built

Not conflicts: nothing here asserts anything false, it is simply absent. Listed so a session reading
only this file knows the shape of what is missing. Roughly in dependency order — each is blocked by
the ones above it.

- [ ] **Every route returns 501** via `todo()` at [`api/inventory.ts:131`](../../node-server/src/api/inventory.ts#L131).
      The `categories` and `inventoryItems` repositories are written and nothing calls them, so this
      is wiring rather than design. PRD §2.5.3's central promise — the form path stays fully usable
      with the LLM off — is met by nothing until it is done.
- [ ] **Nothing has run against Postgres.** `npm test` is deliberately database-free and the
      migrations have never been applied anywhere, so the visibility filter, the `ON DELETE RESTRICT`
      refusal and the attribution join are verified as types and compiled SQL, not as behaviour.
      Decide the lane — a `test:db` script against a local Postgres, or documented manual
      verification — before more is stacked on top.
- [ ] **No inventory tests.** [`node-server/test/`](../../node-server/test/) holds only
      `auth-guards.ts`. The cases that matter: household scoping, the visibility filter, stock
      arithmetic, track-only items (null quantity/unit), and that nothing here imports anything
      reorder-related.
- [ ] **No `/categories` routes at all.** §2.5.1 makes category mandatory and §2.5.4 needs a picker
      over the household's own.
- [ ] **No categories page, no add/edit form, no private toggle, no attribution on the card.**
      The wire shape carries `added_by` and `is_private`; nothing renders them.
- [ ] **No WS route.** `@fastify/websocket` is registered in `app.ts` with nothing attached. The
      push must be visibility-filtered like the read: a private item reaches its owner alone.
- [ ] **No `POST /inventory/interpret`.** The client calls it against a fixture.
