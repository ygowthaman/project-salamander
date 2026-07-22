import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/shopping";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: url.replace(/^postgresql\+\w+:\/\//, "postgresql://"),
  },
});
