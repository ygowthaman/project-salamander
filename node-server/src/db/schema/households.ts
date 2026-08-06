import { randomUUID } from "node:crypto";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./common.js";

export const households = pgTable("households", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  name: text("name").notNull(),
  address: text("address"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
