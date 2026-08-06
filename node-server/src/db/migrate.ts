// Must precede ./client.js, which reads DATABASE_URL at module load.
import "dotenv/config";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../../drizzle");

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}

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
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
}

function targetLabel(): string {
  try {
    const u = new URL(process.env.DATABASE_URL!);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const reset = process.argv.includes("--reset");
  if (reset) {
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
