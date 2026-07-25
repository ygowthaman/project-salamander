import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { users, type User } from "../schema.js";

/**
 * Emails are stored lowercased and matched by a plain unique index, so every
 * read and write path has to normalise. Doing it here rather than in the routes
 * means a new caller cannot forget and create a case-duplicate account.
 */
const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export interface NewUser {
  email: string;
  passwordHash?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
}

export async function createUser(db: DbExecutor, input: NewUser): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      email: normaliseEmail(input.email),
      passwordHash: input.passwordHash ?? null,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      emailVerified: input.emailVerified ?? false,
    })
    .returning();
  return row!;
}

export async function getUserById(db: DbExecutor, id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function getUserByEmail(db: DbExecutor, email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, normaliseEmail(email)))
    .limit(1);
  return row ?? null;
}

export interface UserPatch {
  email?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  passwordHash?: string | null;
  emailVerified?: boolean;
}

export async function updateUser(db: DbExecutor, id: string, patch: UserPatch): Promise<User> {
  const [row] = await db
    .update(users)
    .set({
      ...patch,
      ...(patch.email === undefined ? {} : { email: normaliseEmail(patch.email) }),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  return row!;
}

/** Cascades to oauth_accounts, auth_sessions and chat sessions via the FKs. */
export async function deleteUser(db: DbExecutor, id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}
