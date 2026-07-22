import { randomUUID } from "node:crypto";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// UUIDs are app-generated (crypto.randomUUID), matching the previous Python
// implementation's `default=uuid.uuid4` rather than a DB-side gen_random_uuid().
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().$defaultFn(randomUUID),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type Session = typeof sessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
