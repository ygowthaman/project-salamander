import type { FastifyPluginAsync } from "fastify";

/**
 * Liveness probe. Unauthenticated and deliberately database-free: it answers
 * whether the process is up and serving, not whether Postgres is reachable, so
 * a database blip cannot take the revision out of rotation on its own.
 *
 * It exists because the domain routes do not yet — without it, the only
 * unauthenticated endpoints are the OAuth entry points, and "is the service
 * alive?" would have to be asked with a 401 as the healthy answer.
 */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({ status: "ok" }));
};
