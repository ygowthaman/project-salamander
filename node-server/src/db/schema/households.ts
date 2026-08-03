import { randomUUID } from "node:crypto";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./common.js";

// The ownership root (PRD §2.2). A household owns the data; a user owns only
// their credentials. Every domain table carries `household_id`, and
// `users.household_id` is the only path from a person to anything they can see.
//
// THIS MODULE IMPORTS NOTHING, AND MUST NOT. It sits above `auth.ts` in the
// dependency graph, so an owner/creator FK back to `users` would close a cycle
// with `users.household_id`. Drizzle's lazy `references(() => x.id)` would let
// that survive at runtime while TS inference quietly degrades. Anything that
// expresses a person's relationship to a household — membership, role, whether
// they were ever asked about it — belongs on the user side. The import list
// above is the check.

export const households = pgTable("households", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  // Mandatory: this is what the UI calls the scope in every list and header, so
  // there is no null to render around. A user who skips the create form still
  // gets one, derived from the local part of their email (PRD §2.2.5) — the
  // email rather than the display name because email is the only field
  // guaranteed to be present.
  name: text("name").notNull(),
  // Optional, and a household without one is normal rather than incomplete
  // (PRD §2.2.5). Free text by the same test `categories` passes: nothing joins
  // on it and nothing aggregates it, so drift never escapes the row. Revisit if
  // Phase 2 delivery ever needs to match on it.
  address: text("address"),
  createdAt: createdAt(),
  // Moves when a user who skipped later "creates" a household — which is a
  // rename of this row, never a migration of their data onto a new one
  // (PRD §2.2.4).
  updatedAt: updatedAt(),
});

export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
