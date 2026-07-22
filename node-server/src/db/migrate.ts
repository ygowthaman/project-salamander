// Must precede the ./client.js import — it reads DATABASE_URL at module load.
// server.ts loads dotenv itself; this covers the standalone `npm run db:migrate`.
import "dotenv/config";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/db -> node-server/drizzle (and dist/db -> node-server/drizzle)
const migrationsFolder = path.resolve(here, "../../drizzle");

export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder });
}

// Allow `npm run db:migrate` to apply migrations standalone.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { pool } = await import("./client.js");
  await runMigrations();
  await pool.end();
  console.log("migrations applied");
}
