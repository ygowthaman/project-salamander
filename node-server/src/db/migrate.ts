// Must precede the ./client.js import — it reads DATABASE_URL at module load.
// server.ts loads dotenv itself; this covers the standalone `npm run db:migrate`.
import "dotenv/config";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/db -> node-server/drizzle (and dist/db -> node-server/drizzle)
const migrationsFolder = path.resolve(here, "../../drizzle");

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}

/**
 * Drops every table in `public` plus drizzle's own bookkeeping schema, so the
 * next `runMigrations()` replays the whole chain from empty.
 *
 * Dev-only, and destructive by design: the migrator keys on a hash of each SQL
 * file, so editing a migration that a database has already applied leaves that
 * database permanently unable to migrate (the rewritten file reads as pending
 * and re-runs against tables that exist — `relation "…" already exists`).
 * While the schema is still being drafted that is the normal case, and a wipe
 * is cheaper than hand-writing the catch-up DDL. It is NOT called from
 * `server.ts`; only the CLI below reaches it, only under `--reset`.
 *
 * Enum types go too. Nothing declares a `pgEnum` today, but a leftover type is
 * exactly the kind of orphan that would make a "clean" rebuild fail later.
 */
export async function resetSchema(): Promise<void> {
  await db.execute(sql`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
      END LOOP;
      FOR r IN
        SELECT t.typname FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e'
      LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
      END LOOP;
    END $$;
  `);
  // Drizzle records applied migrations in drizzle.__drizzle_migrations, outside
  // `public` — left behind, it would mark the just-dropped tables as created.
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
}

/** `host/database` from DATABASE_URL, for the pre-drop log line. */
function targetLabel(): string {
  try {
    const u = new URL(process.env.DATABASE_URL!.replace(/^postgresql\+\w+:\/\//, "postgresql://"));
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

// Allow `npm run db:migrate` to apply migrations standalone.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const reset = process.argv.includes("--reset");
  if (reset) {
    // The one hard stop. Everything else about this script assumes dev.
    if (process.env.NODE_ENV === "production") {
      console.error("refusing to --reset with NODE_ENV=production");
      process.exit(1);
    }
    console.log(`dropping all tables in ${targetLabel()}`);
    await resetSchema();
  }
  await runMigrations();
  await pool.end();
  console.log(reset ? "database reset, migrations applied" : "migrations applied");
}
