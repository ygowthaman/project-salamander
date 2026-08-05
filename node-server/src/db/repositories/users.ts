import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { users, type User, type UserRole } from "../schema/index.js";

/**
 * Emails are stored lowercased and matched by a plain unique index, so every
 * read and write path has to normalise. Doing it here rather than in the routes
 * means a new caller cannot forget and create a case-duplicate account.
 */
const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/**
 * What a soft-deleted account's email is overwritten with (PRD §2.2.8: the
 * address is released outright, not held in reserve).
 *
 * `.invalid` is reserved by RFC 2606 and can never be a real address, so the
 * ordinary unique index keeps constraining active accounts only — no partial
 * index, and `email` stays NOT NULL for every path that reads it.
 */
const tombstoneEmail = (id: string): string => `deleted-${id}@salamander.invalid`;

export interface NewUser {
  /**
   * Required, and there is deliberately no overload without it: a user without
   * a household is a state the rest of the system is built to not handle. Go
   * through `repositories/households.ts`, which creates both in one
   * transaction, rather than calling this with a household id you found.
   */
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

/**
 * Active accounts only. A soft-deleted row survives to carry a name onto past
 * inventory entries (PRD §2.2.8) and must never resolve as a person who can
 * sign in, so the `deleted_at` filter belongs here rather than at each call
 * site — `plugin.ts` resolves every request's user through this.
 */
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

/**
 * Retired accounts included. The only legitimate use is rendering the name on
 * an item a departed member added — never authentication, and never membership.
 */
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

/**
 * Retires an account, keeping only the display name (PRD §2.2.8).
 *
 * Irreversible, with no recovery path: every means of signing in is destroyed
 * here — the password is discarded and OAuth links are dropped by their
 * `ON DELETE CASCADE` when the caller revokes sessions and unlinks. The email
 * is replaced with a tombstone so the real address is free to register again
 * the moment this completes, producing a *new*, unrelated account.
 *
 * This is how *every* account deletion ends — there is no hard delete of a user
 * anywhere in the product. Not to be called directly by a route, though: the
 * household side has to decide first whether this member is its last admin, in
 * which case the household is dissolved around them on the way through. See
 * `households.ts` → `deleteAccount`.
 */
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
