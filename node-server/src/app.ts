import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";

import { authRoutes } from "./api/auth.js";
import { sessionsRoutes } from "./api/sessions.js";
import { websocketRoutes } from "./api/websocket.js";
import { allowedOrigins, registerAuth } from "./auth/plugin.js";

/**
 * Builds the fully-wired Fastify instance without binding a port.
 *
 * Split out from server.ts so the app can be exercised with `app.inject()` —
 * the auth guards, CSRF checks and Origin checks all short-circuit before any
 * query runs, so they are testable without a live database.
 */
export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    // Cloud Run terminates TLS and forwards the caller in X-Forwarded-For.
    // Without this every request looks like it came from the proxy, which would
    // collapse the per-IP rate limits into a single shared bucket.
    trustProxy: true,
  });

  await app.register(cors, {
    origin: allowedOrigins(),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    // Must be explicit: the browser preflights the CSRF header, and a preflight
    // that does not allow it fails before the real request is ever sent.
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  });

  // Coarse per-IP ceiling. The strict, account-keyed limits live on the login
  // and signup routes; this one catches an IP probing many different accounts.
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  // Cookie parsing plus the global identify/CSRF hooks. Must precede the routes.
  await registerAuth(app);

  await app.register(websocket);
  await app.register(authRoutes);
  await app.register(sessionsRoutes);
  await app.register(websocketRoutes);

  return app;
}
