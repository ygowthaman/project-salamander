-- Drops the two tables the retired Python backend created, and which nothing in
-- this schema has ever created: `sessions` and `messages`, the conversation
-- thread behind the Phase 1 chat app.
--
-- They are not in `schema/` and no earlier migration in this chain makes them.
-- They exist only on a database that at some point ran the old `py-server`,
-- whose SQLAlchemy `Base.metadata.create_all` built them at startup. That server
-- is gone, and PRD §2.5 specifies no conversational storage: the interpretation
-- exchange is capped at ten turns and explicitly ephemeral (§2.5.7), so there is
-- no durable message state to keep.
--
-- `IF EXISTS` because both cases are normal — a database provisioned from this
-- chain never had them, one inherited from the Python era does. Ordered
-- child-then-parent: `messages.session_id` references `sessions(id)`.
DROP TABLE IF EXISTS "messages";--> statement-breakpoint
DROP TABLE IF EXISTS "sessions";
