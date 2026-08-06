import { randomUUID } from "node:crypto";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./common.js";
import { households } from "./households.js";
import { inventoryItems } from "./inventory.js";

export const mandates = pgTable(
  "mandates",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    parLevel: integer("par_level").notNull(),
    restockLevel: integer("restock_level"),
    triggerCondition: jsonb("trigger_condition").$type<{
      op: string;
      field: string;
      value: number;
    }>(),
    shoppingQuery: text("shopping_query"),
    preferredProduct: jsonb("preferred_product").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("mandates_inventory_item_id_unique").on(t.inventoryItemId),
    index("mandates_household_id_idx").on(t.householdId),
  ],
);

export type Mandate = typeof mandates.$inferSelect;
export type NewMandate = typeof mandates.$inferInsert;
