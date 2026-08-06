import type { FastifyReply } from "fastify";
import { authConfig } from "./config.js";
import { randomToken } from "./tokens.js";

export const ACCESS_COOKIE = "sal_access";
export const REFRESH_COOKIE = "sal_refresh";
export const CSRF_COOKIE = "sal_csrf";
export const OAUTH_STATE_COOKIE = "sal_oauth";

const REFRESH_PATH = "/auth";

// SameSite=Lax holds only while frontend and backend share a registrable domain
// (authConfig.cookieDomain). Move the backend to a *.run.app URL and every
// authenticated request silently 401s.
const base = {
  domain: authConfig.cookieDomain,
  secure: authConfig.cookieSecure,
  sameSite: "lax",
} as const;

export function setAuthCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    httpOnly: true,
    path: "/",
    maxAge: 15 * 60,
  });

  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    httpOnly: true,
    path: REFRESH_PATH,
    maxAge: Math.max(0, Math.floor((tokens.refreshExpiresAt.getTime() - Date.now()) / 1000)),
  });
}

export function setCsrfCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(CSRF_COOKIE, token, {
    ...base,
    httpOnly: false,
    path: "/",
    maxAge: authConfig.refreshTokenTtlDays * 24 * 60 * 60,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { ...base, path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });

  // Rotated rather than deleted: the SPA swaps to the login screen without
  // reloading, so it needs a token to echo on the very next request.
  setCsrfCookie(reply, randomToken());
}

export function setOAuthStateCookie(reply: FastifyReply, value: string): void {
  reply.setCookie(OAUTH_STATE_COOKIE, value, {
    ...base,
    httpOnly: true,
    path: "/auth",
    maxAge: 10 * 60,
    signed: true,
  });
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_STATE_COOKIE, { ...base, path: "/auth" });
}
