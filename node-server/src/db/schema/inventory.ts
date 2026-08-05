import { randomUUID } from "node:crypto";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt } from "./common.js";
import { households } from "./households.js";
import { users } from "./auth.js";
import { categories } from "./categories.js";

// The inventory module. See ./index.ts for the domain-wide notes on how this
// diverges from PRD §6 and why quantities are integers.
//
// THIS MODULE MUST NOT IMPORT ./mandates.js. Decision D1: inventory has no
// knowledge of reordering, and the dependency points one way — mandates reads
// inventory, never the reverse. The import list above is the check.
//
// It DOES import ./auth.js, and it is the only domain module that may. The rule
// is not "no domain table names a user" but "no domain table takes its SCOPE
// from one": `household_id` is what every query filters on, and the user
// columns below are attribution and visibility, which PRD §2.2.9 puts on the
// item itself. Both are nullable FKs onto `users`, never the row's owner.

// EVERY tracked thing, in its complete form — a carton of eggs and a paperback
// are both whole rows here. Deliberately carries nothing about reordering (D1):
// "is this reorderable?" is answered by the existence of a `mandates` row, one
// FK the database enforces, not by a nullable-column convention every consumer
// has to remember.
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    // The pantry belongs to the home. Scoped per user, the same carton of eggs
    // would exist as two rows with two counts, a mandate would fire against one
    // of them, and a budget would total the household's spend at half its real
    // value with nothing erroring.
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // RESTRICT, never cascade: deleting a category with items is a 409 that
    // names the count, not a delete that silently takes a whole collection.
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    // Who put this on the list (PRD §2.2.9). Attribution, NOT ownership — the
    // household owns the item, this is the *who* alongside the household's
    // *whose*, and displaying it is the entire reason a retired user's row
    // survives as a name (§2.2.8).
    //
    // NOT NULL, because §2.5.1 makes it mandatory: every item was added by
    // somebody, and a blank here would be a row the UI cannot attribute and the
    // soft delete has nothing to protect. Bound from the session on write and
    // never changed afterwards — it is not in any request body or update schema.
    //
    // RESTRICT is the only action consistent with that, and it is a net that
    // never fires rather than a behaviour anything relies on: no path in the
    // product hard-deletes a user who has attribution. Deleting an account is a
    // soft delete (§2.2.8), and deleting a household deletes that household's
    // items and re-homes its members (§2.2.8) — so the referencing rows are
    // always gone before the referenced user could be. CASCADE would be wrong
    // in the way §2.2.10 names outright: a departing housemate must never delete
    // the household's stock.
    //
    // Never filter on this to decide what a caller may see — with the single
    // exception of `isPrivate` below, which is the one place it is load-bearing.
    addedByUserId: uuid("added_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Visible only to `added_by_user_id` (PRD §2.2.9) — including from admins,
    // who administer the household but get no privileged view of a member's
    // things. Reads therefore filter `NOT is_private OR added_by_user_id = me`.
    //
    // A private item never outlives its owner's membership: when the member is
    // soft-deleted or leaves, these rows are DELETED rather than left behind,
    // because an item nobody can see has no audience and no remaining member —
    // not even an admin — could read or remove it.
    isPrivate: boolean("is_private").notNull().default(false),
    // Free text by the same test `categories` passes: nothing joins on a unit,
    // so drift never escapes the row. See DB_CONTEXT.md → conventions.
    unit: text("unit"),
    // "How many do I have" — universal, so it lives on the item and not on the
    // reorder side: you can own 1 copy of a book, and NL search filters on it.
    // Null means "tracked, count unknown", which is a legitimate track-only state.
    quantity: integer("quantity"),
    // Genuinely open-ended per item type (author/edition/isbn, model number);
    // feeds NL search rather than any join. Shape is PRD §12.21, still open.
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    // Named `last_updated` per the target model, not the `updated_at` the auth
    // tables use: it tracks when the *stock* last moved, which is what the UI shows.
    lastUpdated: timestamp("last_updated", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("inventory_items_household_id_name_idx").on(t.householdId, t.name),
    // Carries the ON DELETE RESTRICT check and the per-category item counts on
    // GET /categories; without it both are sequential scans.
    index("inventory_items_category_id_idx").on(t.categoryId),
    // Not for reads — those go through the household index above. This one
    // serves the departure paths, which have to find and delete one member's
    // private items before the household stops being theirs, and carries the
    // ON DELETE RESTRICT check on the column above.
    index("inventory_items_added_by_user_id_idx").on(t.addedByUserId),
  ],
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
