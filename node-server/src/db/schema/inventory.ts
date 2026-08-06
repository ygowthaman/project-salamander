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

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    addedByUserId: uuid("added_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    isPrivate: boolean("is_private").notNull().default(false),
    unit: text("unit"),
    quantity: integer("quantity"),
    attributes: jsonb("attributes").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    lastUpdated: timestamp("last_updated", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index("inventory_items_household_id_name_idx").on(t.householdId, t.name),
    index("inventory_items_category_id_idx").on(t.categoryId),
    index("inventory_items_added_by_user_id_idx").on(t.addedByUserId),
  ],
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
