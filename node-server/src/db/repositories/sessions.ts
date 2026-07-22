import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { sessions, type Session } from "../schema.js";

export async function createSession(db: DbExecutor, title: string): Promise<Session> {
  const [row] = await db.insert(sessions).values({ title }).returning();
  // The insert always returns exactly one row; the non-null assert keeps the
  // repository signature free of a nullable that can never happen.
  return row!;
}

export async function getSession(db: DbExecutor, sessionId: string): Promise<Session | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  return row ?? null;
}
