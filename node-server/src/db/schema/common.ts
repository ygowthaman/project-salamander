import { sql } from "drizzle-orm";
import { timestamp } from "drizzle-orm/pg-core";

// Column helpers shared across schema modules. Everything here must stay
// table-agnostic — a helper only one table uses belongs with that table.
//
// Deliberately NOT re-exported from ./index.ts: that barrel is what `client.ts`
// hands to drizzle() as the schema namespace, and it should contain tables.

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`);

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`);
