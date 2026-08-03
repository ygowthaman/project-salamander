import { randomUUID } from "node:crypto";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, updatedAt } from "./common.js";
import { households } from "./households.js";

// User-defined taxonomy, curated from its own management page (PRD §5.1.1) —
// never written by an interpreter as free text. It exists as a table because
// budgets aggregate spend by category: as a string column, an interpreter
// writing `grocery` one day and `groceries` the next would silently split a
// budget with nothing erroring.
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    // The household owns the taxonomy, not the member who happened to create a
    // category — two people in one house share one set of categories, or the
    // same budget splits across "their" copies of Groceries.
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Case-insensitive per household: a second "groceries" is a 409, not a row,
    // and two members cannot each create their own. Unlike users.email this is a
    // lower(name) *expression* index rather than a normalise-on-write
    // convention, because the display casing the user typed is worth keeping —
    // "Books", not "books".
    uniqueIndex("categories_household_id_name_unique").on(t.householdId, sql`lower(${t.name})`),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
