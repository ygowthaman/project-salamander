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
  // Replaces SQLAlchemy's create_all-on-startup with real migrations.
  await runMigrations();
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
