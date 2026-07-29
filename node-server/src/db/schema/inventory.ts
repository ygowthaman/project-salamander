import { randomUUID } from "node:crypto";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt } from "./common.js";
import { users } from "./auth.js";
import { categories } from "./categories.js";

// The inventory module. See ./index.ts for the domain-wide notes on how this
// diverges from PRD §6 and why quantities are integers.
//
// THIS MODULE MUST NOT IMPORT ./mandates.js. Decision D1: inventory has no
// knowledge of reordering, and the dependency points one way — mandates reads
// inventory, never the reverse. The import list above is the check.

// EVERY tracked thing, in its complete form — a carton of eggs and a paperback
// are both whole rows here. Deliberately carries nothing about reordering (D1):
// "is this reorderable?" is answered by the existence of a `mandates` row, one
// FK the database enforces, not by a nullable-column convention every consumer
// has to remember.
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // RESTRICT, never cascade: deleting a category with items is a 409 that
    // names the count, not a delete that silently takes a whole collection.
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
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
    index("inventory_items_user_id_name_idx").on(t.userId, t.name),
    // Carries the ON DELETE RESTRICT check and the per-category item counts on
    // GET /categories; without it both are sequential scans.
    index("inventory_items_category_id_idx").on(t.categoryId),
  ],
);

// Audit trail: one row per applied stock change, written in the same
// transaction as the item update it describes.
export const inventoryEvents = pgTable(
  "inventory_events",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    // Nullable: an absolute set on an item whose quantity was null has no
    // meaningful delta. `new_stock` is what always exists, so it is the NOT NULL one.
    delta: integer("delta"),
    newStock: integer("new_stock").notNull(),
    // For an interpreted write this holds the user's ORIGINAL PHRASE ("low on
    // eggs"). The qualitative word is never persisted as data anywhere else —
    // the number is the data, this is the provenance.
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_events_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("inventory_events_item_id_created_at_idx").on(t.inventoryItemId, t.createdAt),
  ],
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
export type InventoryEvent = typeof inventoryEvents.$inferSelect;
export type NewInventoryEvent = typeof inventoryEvents.$inferInsert;
