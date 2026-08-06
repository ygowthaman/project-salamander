import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { oauthAccounts, type OauthAccount } from "../schema/index.js";

export const GOOGLE = "google";

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

export async function unlinkAll(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(oauthAccounts).where(eq(oauthAccounts.userId, userId));
}
