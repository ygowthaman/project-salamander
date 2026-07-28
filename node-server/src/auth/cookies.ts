import type { FastifyReply } from "fastify";
import { authConfig } from "./config.js";

export const ACCESS_COOKIE = "sal_access";
export const REFRESH_COOKIE = "sal_refresh";
export const CSRF_COOKIE = "sal_csrf";
export const OAUTH_STATE_COOKIE = "sal_oauth";

/**
 * The refresh cookie is scoped to /auth so it is not attached to ordinary API
 * or WebSocket requests — only /auth/refresh and /auth/logout ever need it,
 * and a narrower path means fewer places it can leak from.
 */
const REFRESH_PATH = "/auth";

/**
 * SameSite=Lax works here only because the frontend and backend share the
 * registrable domain `axoliz.ai` (see authConfig.cookieDomain). If the backend
 * is ever moved back to a *.run.app URL, these cookies stop being sent on
 * cross-site fetches and every authenticated request silently 401s.
 */
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

/**
 * Deliberately NOT httpOnly — the frontend has to read this value to echo it in
 * the X-CSRF-Token header. That is safe: the token is worthless to an attacker
 * on another origin, who can neither read our cookies nor set a custom header
 * on a cross-site request without passing CORS preflight.
 */
export function setCsrfCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(CSRF_COOKIE, token, {
    ...base,
    httpOnly: false,
    path: "/",
    maxAge: authConfig.refreshTokenTtlDays * 24 * 60 * 60,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  // Path and domain must match what was set, or the browser keeps the original.
  reply.clearCookie(ACCESS_COOKIE, { ...base, path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
  reply.clearCookie(CSRF_COOKIE, { ...base, path: "/" });
}

/** Short-lived holder for the OAuth `state` + PKCE verifier during the redirect. */
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
