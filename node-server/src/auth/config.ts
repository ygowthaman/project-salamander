/**
 * Auth configuration, resolved once at module load.
 *
 * Google credentials are optional on purpose: without them the server still
 * boots and email+password login works, so local dev and CI do not need an
 * OAuth client. `/auth/google` reports 503 when they are absent rather than
 * failing at startup.
 */

const DEV_JWT_SECRET = "dev-only-insecure-secret-change-me-32chars";

function resolveJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required in production");
    }
    return new TextEncoder().encode(DEV_JWT_SECRET);
  }

  // HS256 keys shorter than the 256-bit hash output weaken the signature.
  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

const isProduction = process.env.NODE_ENV === "production";

/** Where the browser is sent after a successful OAuth round-trip. */
const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "");

/**
 * Public origin of *this* server. Google redirects the browser back here, so it
 * must exactly match an Authorised redirect URI on the OAuth client — in
 * production that is the api.axoliz.ai domain mapping, not the run.app URL.
 */
const publicApiUrl = (process.env.PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

export const authConfig = {
  jwtSecret: resolveJwtSecret(),
  isProduction,
  frontendUrl,
  publicApiUrl,

  accessTokenTtl: "15m",
  /** Absolute lifetime of a refresh token; rotation does not extend it. */
  refreshTokenTtlDays: 30,

  /**
   * Set to `axoliz.ai` in production so one cookie covers both
   * salamander.axoliz.ai (frontend) and api.axoliz.ai (backend) — that shared
   * registrable domain is what keeps the cookie same-site under SameSite=Lax.
   * Left undefined locally, where both sides are localhost and a Domain
   * attribute would only narrow things unnecessarily.
   */
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  /** Secure cookies are dropped by browsers over plain http://localhost. */
  cookieSecure: isProduction,

  google:
    googleClientId && googleClientSecret
      ? {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
          redirectUri: `${publicApiUrl}/auth/google/callback`,
        }
      : null,
} as const;

export type AuthConfig = typeof authConfig;
