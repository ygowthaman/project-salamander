import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { authConfig } from "./config.js";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";

// Google still issues both spellings of the issuer claim.
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const jwks = createRemoteJWKSet(new URL(JWKS_URI));

export class GoogleAuthError extends Error {}

function requireGoogleConfig() {
  if (!authConfig.google) {
    throw new GoogleAuthError("Google OAuth is not configured");
  }
  return authConfig.google;
}

export const isGoogleConfigured = (): boolean => authConfig.google !== null;

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
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

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
    throw new GoogleAuthError(`Google token exchange failed (${response.status})`);
  }

  const payload = (await response.json()) as { id_token?: string };
  if (!payload.id_token) {
    throw new GoogleAuthError("Google token response contained no id_token");
  }

  return verifyIdToken(payload.id_token);
}

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
    // Google has historically sent this as the string "true" as well as a boolean.
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: typeof claims.name === "string" ? claims.name : null,
    picture: typeof claims.picture === "string" ? claims.picture : null,
  };
}
