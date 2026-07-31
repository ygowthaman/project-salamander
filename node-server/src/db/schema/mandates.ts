import { randomUUID } from "node:crypto";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./common.js";
import { users } from "./auth.js";
import { inventoryItems } from "./inventory.js";

// The reorder side. It imports inventory; inventory must never import it (D1).
// The rest of the reorder module — grants, budgets, windows, runs — lands in
// Phase 2 and joins here, not to inventory.

// The reorder opt-in. NOT part of the inventory module — it lives here only
// because it owns the two columns that used to sit on the item (D1/D4), and
// nothing in the inventory chunks may read it directly.
//
// ONE ROW PER ITEM, and the row's existence IS the opt-in. Changing your mind
// about a rule is an UPDATE, never a second row (D4).
//
// Nullable here means "not yet supplied", NEVER "inapplicable": every row is by
// definition a reorderable item, so par/restock always apply, and a null
// `trigger_condition` is an item opted in before Phase 2 wrote its rule. If a
// column ever turns up that is inapplicable to some rows, that is the signal to
// split this table again.
export const mandates = pgTable(
  "mandates",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    // Denormalised from the item, per the convention every user-owned table
    // follows. Must be written from the item's owner, never from a request body.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),

    // --- levels (Chunk 2b, live now) ---
    // NOT NULL: opting an item in without saying what "normal" means is
    // meaningless, and this is the threshold "low on eggs" anchors against.
    parLevel: integer("par_level").notNull(),
    // The resulting stock target when a reorder is PLACED (eggs → 12, bread → 1).
    // Falls back to par_level when unset — a same-row lookup now (PRD §12.23).
    restockLevel: integer("restock_level"),

    // --- the buying rule (columns created now, populated in Phase 2) ---
    // Created up front so the table shape is settled and Phase 2 only writes to
    // it. jsonb rather than {op, field, value} columns because the scheduler
    // evaluates this in application code; nothing SQL-queries its parts.
    triggerCondition: jsonb("trigger_condition").$type<{
      op: string;
      field: string;
      value: number;
    }>(),
    // WHAT to buy, which may differ from the item and carries its own
    // quantity/packaging — "2 × 2L whole milk" where restock_level is just 4.
    shoppingQuery: text("shopping_query"),
    // Last product chosen, reused to stabilise matching across runs (PRD §5.10).
    preferredProduct: jsonb("preferred_product").$type<Record<string, unknown>>(),

    // grant_id is DEFERRED to Phase 2 on purpose: its FK target `grants` does
    // not exist, and pulling that table in now would add one with no Phase 1
    // consumer. Adding a nullable FK column later is purely additive.

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // ONE rule per item. This is the constraint that makes a separate levels
    // table unnecessary — drop it first if a real multi-rule case ever appears.
    uniqueIndex("mandates_inventory_item_id_unique").on(t.inventoryItemId),
    index("mandates_user_id_idx").on(t.userId),
  ],
);

export type Mandate = typeof mandates.$inferSelect;
export type NewMandate = typeof mandates.$inferInsert;
