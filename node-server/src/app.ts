import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";

import { authRoutes } from "./api/auth.js";
import { healthRoutes } from "./api/health.js";
import { householdRoutes } from "./api/households.js";
import { inventoryRoutes } from "./api/inventory.js";
import { allowedOrigins, registerAuth } from "./auth/plugin.js";

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    // Without this, Cloud Run's proxy is every caller's IP and the per-IP rate
    // limits collapse into one shared bucket.
    trustProxy: true,
  });

  await app.register(cors, {
    origin: allowedOrigins(),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  });

  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  await registerAuth(app);

  await app.register(websocket);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(householdRoutes);
  await app.register(inventoryRoutes);

  return app;
}
