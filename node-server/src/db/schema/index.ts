// The schema barrel. This is the single entry point for both consumers:
//
//   - `client.ts` does `import * as schema` and hands the namespace to drizzle()
//   - `drizzle.config.ts` points `schema:` at this file
//
// Both read the same list on purpose. A glob (`schema/*.ts`) would also work for
// drizzle-kit, but then a module missing from this barrel would appear in
// migrations while being invisible to `db.query` — so keep one source of truth
// and re-export every table module here. (`common.ts` is intentionally absent:
// it holds column helpers, not tables, and keeping it out leaves the namespace
// drizzle() receives free of non-table exports.)
//
// REQUIRES drizzle-kit >= 0.31. Under 0.28.1 the schema was loaded through CJS
// `require`, which cannot resolve the `./auth.js` specifiers NodeNext ESM
// obliges us to write, so any cross-file import failed `db:generate` with
// MODULE_NOT_FOUND. That is why this was one file until the Drizzle upgrade.
// Do not downgrade drizzle-kit without collapsing this folder back.
//
// Module order below follows the dependency graph, which is acyclic and must
// stay that way: households <- auth <- categories <- inventory <- mandates.
// Drizzle's `references(() => x.id)` is lazy so a cycle would survive at
// runtime, but TS inference degrades badly and the failure is confusing. If two
// modules ever need each other, that is a signal the tables belong together.
//
// Two invariants sit on that order:
//
//   - `households.ts` imports nothing. It is the root, and an owner/creator FK
//     back to `users` would close a cycle with `users.household_id`.
//   - `inventory.ts` must never import `mandates.js` (decision D1) — as
//     separate files that is greppable rather than merely written down.
//
// ---------------------------------------------------------------------------
// Ownership (PRD §2.2)
//
// A HOUSEHOLD owns the data; a user owns only their credentials. Every domain
// table carries `household_id`, and `users.household_id` — NOT NULL, always
// present, auto-provisioned when the user skips the create form — is the only
// path from a person to anything they can see. There is exactly one ownership
// shape, so nothing downstream has to handle a lone user as a second case.
//
// A domain table referencing `users(id)` for scope is a bug, not a variation.
// `oauth_accounts` and `auth_sessions` do it because they are credentials;
// `inventory_items.added_by_user_id` and `inventory_events.actor_user_id` name
// a user for attribution and privacy (§2.2.9), never to decide ownership.
//
// ---------------------------------------------------------------------------
// Domain-wide notes (roadmap Phase 1b)
//
// The operative model is docs/context/INVENTORY_CONTEXT.md §2, NOT docs/PRD.md
// §6: decisions D1 + D4 moved `par_level` / `restock_level` off `inventory_items`
// onto `mandates`, one row per item. The PRD is knowingly stale on that point
// until the Chunk 8 reconciliation pass — do not "fix" this back to match it.
//
// Quantities are `integer`, NOT the fractional value PRD §5.1 describes (D5).
// `unit` is user-defined free text, so the user picks the granularity at which
// things are whole: half a dozen eggs is `6 × each`, not `0.5 × dozen`; a
// half-kilo bag of rice is `1 × "1/2 kg bag"`. That makes the interpreter's
// target well-defined — there is one right number per physical state instead of
// several equivalent encodings — and the qualitative bands fall out cleanly
// ("out" → 0, "low" → 1).
//
// Known cost: a part-used package has no whole number. A half-eaten bag counts
// as 1, so a reorder fires one cycle later than ideal. Accepted — the number
// feeds a threshold comparison and a table the user reads, neither of which
// needs sub-unit resolution. Money is the case that would need `numeric`, and
// it belongs to `budgets`, a table that does not exist yet.
//
// Practical upshot: `pg` parses int4 straight to a JS number, so there is no
// string round-trip and repositories need no parsing layer.
// ---------------------------------------------------------------------------

export * from "./households.js";
export * from "./auth.js";
export * from "./categories.js";
export * from "./inventory.js";
export * from "./mandates.js";
