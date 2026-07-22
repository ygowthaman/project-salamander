import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { messages, type Message } from "../schema.js";

export async function saveMessage(
  db: DbExecutor,
  sessionId: string,
  role: string,
  content: string,
): Promise<Message> {
  const [row] = await db.insert(messages).values({ sessionId, role, content }).returning();
  return row!;
}

export async function getHistory(db: DbExecutor, sessionId: string): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(asc(messages.createdAt));
}
