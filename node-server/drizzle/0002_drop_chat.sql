-- Removes the chat app's persistence: the `sessions` and `messages` tables.
--
-- DESTRUCTIVE: every stored conversation goes with them. That is the intent —
-- Salamander has no conversational surface (docs/ARCHITECTURE.md → The role of
-- the LLM), so nothing is left that would read these rows. Local dev databases
-- carry chat rows; expect them to disappear on the next boot.
--
-- `messages` is dropped first: its session_id FK points at `sessions`.
-- The auth tables are untouched — `sessions.user_id` referenced `users`, not the
-- other way round, so dropping it costs the auth side nothing.
--
-- Machine-generated (drizzle-kit generate), which works again now that 0001
-- committed a snapshot.

DROP TABLE "messages" CASCADE;--> statement-breakpoint
DROP TABLE "sessions" CASCADE;
