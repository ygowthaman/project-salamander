import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { users, type User, type UserRole } from "../schema/index.js";

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

const tombstoneEmail = (id: string): string => `deleted-${id}@salamander.invalid`;

export interface NewUser {
  householdId: string;
  email: string;
  passwordHash?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  role?: UserRole;
  skipHousehold?: boolean;
}

export async function createUser(db: DbExecutor, input: NewUser): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      householdId: input.householdId,
      email: normaliseEmail(input.email),
      passwordHash: input.passwordHash ?? null,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      emailVerified: input.emailVerified ?? false,
      role: input.role ?? "user",
      skipHousehold: input.skipHousehold ?? true,
    })
    .returning();
  return row!;
}

export async function getUserById(db: DbExecutor, id: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getUserByEmail(db: DbExecutor, email: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, normaliseEmail(email)), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getUserByIdIncludingDeleted(
  db: DbExecutor,
  id: string,
): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function listMembers(db: DbExecutor, householdId: string): Promise<User[]> {
  return db
    .select()
    .from(users)
    .where(and(eq(users.householdId, householdId), isNull(users.deletedAt)));
}

export interface UserPatch {
  email?: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  passwordHash?: string | null;
  emailVerified?: boolean;
  householdId?: string;
  role?: UserRole;
  skipHousehold?: boolean;
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

export async function softDeleteUser(db: DbExecutor, id: string): Promise<void> {
  await db
    .update(users)
    .set({
      email: tombstoneEmail(id),
      passwordHash: null,
      avatarUrl: null,
      emailVerified: false,
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));
}
