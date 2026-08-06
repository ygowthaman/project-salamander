import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/client.js";
import * as usersRepo from "../db/repositories/users.js";
import type { User } from "../db/schema/index.js";
import { authConfig } from "./config.js";
import { ACCESS_COOKIE, CSRF_COOKIE, setCsrfCookie } from "./cookies.js";
import { randomToken, verifyAccessToken } from "./tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Top-level navigations from accounts.google.com cannot carry a CSRF header;
// the signed `state` cookie is what protects them instead.
const CSRF_EXEMPT_PATHS = new Set(["/auth/google", "/auth/google/callback"]);

export function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie, {
    secret: Buffer.from(authConfig.jwtSecret),
  });

  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.cookies[CSRF_COOKIE]) {
      setCsrfCookie(reply, randomToken());
    }

    const token = request.cookies[ACCESS_COOKIE];
    if (!token) return;

    const userId = await verifyAccessToken(token);
    if (!userId) return;

    request.user = await usersRepo.getUserById(db, userId);
  });

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    if (CSRF_EXEMPT_PATHS.has(new URL(request.url, "http://x").pathname)) return;

    const origin = request.headers.origin;
    if (origin && !allowedOrigins().includes(origin)) {
      return reply.code(403).send({ detail: "Origin not allowed" });
    }

    const cookieToken = request.cookies[CSRF_COOKIE];
    const headerToken = request.headers["x-csrf-token"];
    if (!cookieToken || typeof headerToken !== "string" || headerToken !== cookieToken) {
      return reply.code(403).send({ detail: "Invalid CSRF token" });
    }
  });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    return reply.code(401).send({ detail: "Not authenticated" });
  }
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    email_verified: user.emailVerified,
    created_at: user.createdAt.toISOString(),
    household_id: user.householdId,
    skip_household: user.skipHousehold,
    role: user.role,
  };
}
