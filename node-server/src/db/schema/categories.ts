import { randomUUID } from "node:crypto";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, updatedAt } from "./common.js";
import { households } from "./households.js";

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("categories_household_id_name_unique").on(t.householdId, sql`lower(${t.name})`),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
