const DEV_JWT_SECRET = "dev-only-insecure-secret-change-me-32chars";

function resolveJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is required in production");
    }
    return new TextEncoder().encode(DEV_JWT_SECRET);
  }

  if (secret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}

const isProduction = process.env.NODE_ENV === "production";

const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "");

const publicApiUrl = (process.env.PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

export const authConfig = {
  jwtSecret: resolveJwtSecret(),
  isProduction,
  frontendUrl,
  publicApiUrl,

  accessTokenTtl: "15m",
  refreshTokenTtlDays: 30,

  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
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
