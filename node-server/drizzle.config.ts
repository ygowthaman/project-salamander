import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/shopping";

export default defineConfig({
  // The barrel, deliberately — not a `schema/*.ts` glob. drizzle-kit resolves
  // re-exports transitively, so this is the same list `client.ts` hands to
  // drizzle(), and the two cannot drift apart. Needs drizzle-kit >= 0.31 to
  // resolve the `.js` specifiers NodeNext requires; see src/db/schema/index.ts.
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: url.replace(/^postgresql\+\w+:\/\//, "postgresql://"),
  },
});
