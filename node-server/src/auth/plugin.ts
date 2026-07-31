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
    /** Populated from the access cookie on every request; null when anonymous. */
    user: User | null;
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Routes that legitimately arrive without a CSRF token.
 *
 * Both are GETs that Google drives, so they carry no CSRF header and cannot:
 * the callback is a top-level navigation from accounts.google.com. It is
 * protected instead by the `state` parameter, which is compared against a
 * signed, httpOnly cookie the attacker cannot forge.
 */
const CSRF_EXEMPT_PATHS = new Set(["/auth/google", "/auth/google/callback"]);

export function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Registers cookie parsing and the global auth hooks on the *root* instance.
 *
 * Deliberately not a `fastify-plugin`-wrapped plugin: registering these hooks
 * and the `user` decorator directly on the root app makes them apply to every
 * route without pulling in another dependency for encapsulation-breaking.
 */
export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(cookie, {
    // Signs the short-lived OAuth state cookie. Reuses the JWT secret because
    // both are server-side integrity checks with the same rotation story.
    secret: Buffer.from(authConfig.jwtSecret),
  });

  app.decorateRequest("user", null);

  // Identify the caller. Never rejects — routes decide whether anonymous is OK.
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.cookies[CSRF_COOKIE]) {
      // Mint on first contact so the SPA always has a token to echo before it
      // attempts its first mutation (it bootstraps with GET /auth/me).
      setCsrfCookie(reply, randomToken());
    }

    const token = request.cookies[ACCESS_COOKIE];
    if (!token) return;

    const userId = await verifyAccessToken(token);
    if (!userId) return;

    request.user = await usersRepo.getUserById(db, userId);
  });

  // CSRF: SameSite=Lax is the baseline, but PRD §3.4 requires defence in depth
  // for money-adjacent actions, so mutations also need a matching double-submit
  // token and a recognised Origin.
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

/** preHandler for routes that require a signed-in user. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    return reply.code(401).send({ detail: "Not authenticated" });
  }
}

/** The shape returned to the client — never includes password_hash. */
export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    email_verified: user.emailVerified,
    created_at: user.createdAt.toISOString(),
  };
}
