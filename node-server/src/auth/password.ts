import { Algorithm, hash, verify } from "@node-rs/argon2";

const OPTIONS = { algorithm: Algorithm.Argon2id } as const;

const DUMMY_HASH = await hash("dummy-password-for-timing-equalisation", OPTIONS);

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (storedHash === null) {
    // Burn the same ~50ms as a real verify, or timing reveals OAuth-only accounts.
    await verify(DUMMY_HASH, password).catch(() => false);
    return false;
  }

  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
