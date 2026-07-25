import { Algorithm, hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 ships prebuilt binaries (including linux-arm64), so there is
// no node-gyp toolchain to install locally or in the Cloud Buildpacks build.
// Library defaults are the OWASP-recommended m=19456, t=2, p=1.
const OPTIONS = { algorithm: Algorithm.Argon2id } as const;

/** Precomputed so an unknown email costs the same wall-clock time as a known one. */
const DUMMY_HASH = await hash("dummy-password-for-timing-equalisation", OPTIONS);

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/**
 * Verify a password against a stored hash. `storedHash` is null for accounts
 * that only ever signed in with Google.
 *
 * The null branch still runs a real verification against a dummy hash: argon2
 * takes ~50ms, so returning early would make "this account has no password"
 * measurably faster than "wrong password" and leak which accounts are
 * OAuth-only. Same reason `/auth/login` returns an identical 401 either way.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash === null) {
    await verify(DUMMY_HASH, password).catch(() => false);
    return false;
  }

  try {
    return await verify(storedHash, password);
  } catch {
    // Malformed hash in the database — treat as a failed login, never a 500.
    return false;
  }
}
