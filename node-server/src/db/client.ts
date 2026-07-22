import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

// SQLAlchemy required a `postgresql+asyncpg://` dialect suffix; `pg` does not
// understand it. Strip it so an old .env keeps working.
const connectionString = url.replace(/^postgresql\+\w+:\/\//, "postgresql://");

export const pool = new pg.Pool({ connectionString });

export const db = drizzle(pool, { schema });

export type Db = typeof db;

/** A pool-backed handle or a transaction handle — repositories accept either. */
export type DbExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
