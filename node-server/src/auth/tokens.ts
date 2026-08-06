import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { authConfig } from "./config.js";

const ISSUER = "salamander";

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(authConfig.accessTokenTtl)
    .sign(authConfig.jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, authConfig.jwtSecret, { issuer: ISSUER });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export interface MintedRefreshToken {
  token: string;
  hash: string;
  expiresAt: Date;
}

export function mintRefreshToken(): MintedRefreshToken {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + authConfig.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  return { token, hash: hashRefreshToken(token), expiresAt };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
