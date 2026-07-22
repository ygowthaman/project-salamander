import "dotenv/config";

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";

import { sessionsRoutes } from "./api/sessions.js";
import { websocketRoutes } from "./api/websocket.js";
import { pool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";

// Local dev defaults to 8000 (matching the frontend's VITE_API_URL fallback);
// the container sets PORT=8080.
const PORT = Number(process.env.PORT ?? 8000);
const HOST = process.env.HOST ?? "0.0.0.0";
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "http://localhost:5173";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: ALLOWED_ORIGINS.split(",").map((o) => o.trim()),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
});

await app.register(websocket);
await app.register(sessionsRoutes);
await app.register(websocketRoutes);

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
