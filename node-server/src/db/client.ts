import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new pg.Pool({ connectionString: url });

export const db = drizzle(pool, { schema });

export type Db = typeof db;

/** A pool-backed handle or a transaction handle — repositories accept either. */
export type DbExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
