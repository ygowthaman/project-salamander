import { and, eq, isNull, ne } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { authSessions, type AuthSession } from "../schema/index.js";

export async function createAuthSession(
  db: DbExecutor,
  input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  },
): Promise<AuthSession> {
  const [row] = await db
    .insert(authSessions)
    .values({
      userId: input.userId,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    })
    .returning();
  return row!;
}

// Returns revoked and expired rows too: the refresh route has to tell an
// unknown token apart from a replayed one.
export async function getByRefreshHash(
  db: DbExecutor,
  refreshTokenHash: string,
): Promise<AuthSession | null> {
  const [row] = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.refreshTokenHash, refreshTokenHash))
    .limit(1);
  return row ?? null;
}

export const isUsable = (session: AuthSession): boolean =>
  session.revokedAt === null && session.expiresAt.getTime() > Date.now();

export async function revoke(db: DbExecutor, id: string): Promise<void> {
  await db.update(authSessions).set({ revokedAt: new Date() }).where(eq(authSessions.id, id));
}

export async function revokeAllForUser(
  db: DbExecutor,
  userId: string,
  exceptId?: string,
): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
        ...(exceptId ? [ne(authSessions.id, exceptId)] : []),
      ),
    );
}
