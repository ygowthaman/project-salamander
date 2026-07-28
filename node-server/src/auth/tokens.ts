import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { authConfig } from "./config.js";

const ISSUER = "salamander";

/**
 * Short-lived access token. Deliberately carries nothing but the subject —
 * anything else (email, display name) would go stale for up to the token's
 * lifetime, and the routes that need it can read the row.
 */
export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(authConfig.accessTokenTtl)
    .sign(authConfig.jwtSecret);
}

/** Returns the user id, or null for any invalid/expired/tampered token. */
export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, authConfig.jwtSecret, { issuer: ISSUER });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export interface MintedRefreshToken {
  /** Sent to the browser. Never persisted. */
  token: string;
  /** Persisted in auth_sessions. Never sent anywhere. */
  hash: string;
  expiresAt: Date;
}

/**
 * Refresh tokens are opaque random bytes rather than JWTs: they are looked up
 * in `auth_sessions` on every use, so revocation is a row update instead of a
 * blocklist, and there is no signature to verify offline.
 */
export function mintRefreshToken(): MintedRefreshToken {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  return { token, hash: hashRefreshToken(token), expiresAt };
}

/**
 * Plain SHA-256, not a password hash: the input is 256 bits of entropy we
 * generated, so it is not brute-forceable and a slow KDF would only add latency
 * to every refresh. The hash exists so a database leak cannot be replayed.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Random value for the OAuth `state` parameter and the CSRF cookie. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
