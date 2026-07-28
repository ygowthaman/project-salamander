import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { authConfig } from "./config.js";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

// Google still issues both spellings of the issuer claim.
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// Module-level so the JWKS is fetched once and cached across requests rather
// than on every sign-in.
const jwks = createRemoteJWKSet(new URL(JWKS_URI));

export class GoogleAuthError extends Error {}

function requireGoogleConfig() {
  if (!authConfig.google) {
    throw new GoogleAuthError("Google OAuth is not configured");
  }
  return authConfig.google;
}

export const isGoogleConfigured = (): boolean => authConfig.google !== null;

/** PKCE verifier: 32 random bytes, base64url — well inside the 43–128 char range. */
export function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function codeChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(params: { state: string; codeVerifier: string }): string {
  const google = requireGoogleConfig();

  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", google.clientId);
  url.searchParams.set("redirect_uri", google.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", codeChallengeFor(params.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  // Without this a user already signed into Google is silently reused, which
  // makes "sign in as someone else" impossible.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleProfile {
  /** Google's stable subject id. The only safe key to link an account on. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/** Exchanges the one-time code for tokens, then validates the returned ID token. */
export async function exchangeCodeForProfile(
  code: string,
  codeVerifier: string,
): Promise<GoogleProfile> {
  const google = requireGoogleConfig();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: google.redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    // Body may carry the client secret context; log the status only.
    throw new GoogleAuthError(`Google token exchange failed (${response.status})`);
  }

  const payload = (await response.json()) as { id_token?: string };
  if (!payload.id_token) {
    throw new GoogleAuthError("Google token response contained no id_token");
  }

  return verifyIdToken(payload.id_token);
}

/**
 * Verifies signature, issuer and audience. The audience check is the one that
 * matters most: without it an ID token minted for a *different* Google OAuth
 * client would be accepted here, letting anyone with their own client sign in
 * as any user.
 */
export async function verifyIdToken(idToken: string): Promise<GoogleProfile> {
  const google = requireGoogleConfig();

  let claims;
  try {
    ({ payload: claims } = await jwtVerify(idToken, jwks, {
      issuer: ISSUERS,
      audience: google.clientId,
    }));
  } catch (err) {
    throw new GoogleAuthError(`Invalid Google ID token: ${(err as Error).message}`);
  }

  const sub = claims.sub;
  const email = typeof claims.email === "string" ? claims.email : null;
  if (!sub || !email) {
    throw new GoogleAuthError("Google ID token is missing sub or email");
  }

  return {
    sub,
    email: email.toLowerCase(),
    // Google sends this as a boolean, but has historically also sent "true".
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };
}
