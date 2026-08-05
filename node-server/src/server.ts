import "dotenv/config";

import { buildApp } from "./app.js";
import { pool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

// Local dev defaults to 8000 (matching the frontend's VITE_API_URL fallback);
// the container sets PORT=8080.
const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = await buildApp();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => pool.end());
  });
}

try {
  // Versioned migrations, not create-tables-on-boot: this can alter existing
  // tables, which is the whole reason it runs before `listen`.
  await runMigrations();
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
