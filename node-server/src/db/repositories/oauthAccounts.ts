import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { oauthAccounts, type OauthAccount } from "../schema.js";

export const GOOGLE = "google";

/**
 * Looks up the link by the provider's stable subject id. Matching on email
 * instead would re-point the link at whoever currently holds that address if a
 * Google account's email ever changes.
 */
export async function getByProviderAccount(
  db: DbExecutor,
  provider: string,
  providerAccountId: string,
): Promise<OauthAccount | null> {
  const [row] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerAccountId, providerAccountId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function linkAccount(
  db: DbExecutor,
  input: { userId: string; provider: string; providerAccountId: string },
): Promise<OauthAccount> {
  const [row] = await db.insert(oauthAccounts).values(input).returning();
  return row!;
}

/** Backs the "connected accounts" section of the account settings screen. */
export async function listForUser(db: DbExecutor, userId: string): Promise<OauthAccount[]> {
  return db.select().from(oauthAccounts).where(eq(oauthAccounts.userId, userId));
}

export async function unlinkAccount(
  db: DbExecutor,
  userId: string,
  provider: string,
): Promise<void> {
  await db
    .delete(oauthAccounts)
    .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)));
}
