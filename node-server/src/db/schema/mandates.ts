import { randomUUID } from "node:crypto";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./common.js";
import { households } from "./households.js";
import { inventoryItems } from "./inventory.js";

// The reorder side. It imports inventory; inventory must never import it — the
// dependency points one way. The rest of the reorder module — grants, budgets,
// windows, runs — lands in Phase 2 and joins here, not to inventory.

// The reorder opt-in. NOT part of the inventory module: PRD §2.5.1 keeps the
// item record silent about buying the thing, and nothing in inventory may read
// this table directly.
//
// ONE ROW PER ITEM, and the row's existence IS the opt-in. Changing your mind
// about a rule is an UPDATE, never a second row — several rules per item would
// need precedence in the scheduler and leave the user reasoning about which
// fired, for no benefit either of them gets.
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
    // Denormalised from the item, per the convention every domain table
    // follows. Must be copied from the item's household, never read from a
    // request body — a mandate is the household's reorder rule, not the rule of
    // whichever member happened to set it.
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),

    // --- levels (live now) ---
    // NOT NULL: opting an item in without saying what "normal" means is
    // meaningless, and this is the threshold "low on eggs" anchors against.
    parLevel: integer("par_level").notNull(),
    // The resulting stock target when a reorder is PLACED (eggs → 12, bread → 1).
    // Falls back to par_level when unset — a same-row lookup. Reorder is not in
    // the PRD at all, so the fallback is this module's own choice, not a spec.
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
    // Last product chosen, reused to stabilise matching across runs. Unspecified
    // — like the rest of this table, it predates the PRD's coverage.
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
    index("mandates_household_id_idx").on(t.householdId),
  ],
);

export type Mandate = typeof mandates.$inferSelect;
export type NewMandate = typeof mandates.$inferInsert;
