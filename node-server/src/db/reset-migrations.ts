// Deletes the whole `drizzle/` folder so the `drizzle-kit generate` that follows
// writes a single baseline migration instead of a diff against the last one.
//
// This is half of the current dev-cycle contract; `migrate.ts --reset` is the
// other half. Nothing holds data worth keeping, so the schema is not versioned
// yet — it is *republished*: `db:generate` throws the chain away and re-derives
// one `0000_init.sql` from `schema/`, `db:migrate` drops every table and replays
// it. The alternative, keeping applied migrations and appending diffs, costs a
// hand-written catch-up file for every draft edit and leaves the SQL a history of
// intermediate shapes nobody will ever need to reach.
//
// Wiping first also keeps generation non-interactive. drizzle-kit cannot tell a
// rename from a create+drop and prompts for the answer — a prompt that needs a
// real TTY and aborts under piped input or CI. Against an empty folder every
// table is a create, so there is no ambiguity left to ask about.
//
// Switch back to appending diffs before any database holds real data; see
// DB_CONTEXT.md → migrate.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/db -> node-server/drizzle, matching `out` in drizzle.config.ts.
const migrationsFolder = path.resolve(here, "../../drizzle");

const existed = fs.existsSync(migrationsFolder);
fs.rmSync(migrationsFolder, { recursive: true, force: true });
console.log(
  existed
    ? `cleared ${migrationsFolder} — regenerating baseline`
    : `no migrations at ${migrationsFolder} — generating baseline`,
);
