import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { sessions, type Session } from "../schema.js";

export async function createSession(
  db: DbExecutor,
  userId: string,
  title: string,
): Promise<Session> {
  const [row] = await db.insert(sessions).values({ userId, title }).returning();
  // The insert always returns exactly one row; the non-null assert keeps the
  // repository signature free of a nullable that can never happen.
  return row!;
}

/**
 * Scoped by owner on purpose — there is no unscoped `getSession`, so a caller
 * cannot accidentally read another user's conversation. A miss and a
 * wrong-owner hit are indistinguishable here, which is what lets the routes
 * return 404 rather than 403 and avoid confirming that an id exists.
 */
export async function getSessionForUser(
  db: DbExecutor,
  sessionId: string,
  userId: string,
): Promise<Session | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);
  return row ?? null;
}
