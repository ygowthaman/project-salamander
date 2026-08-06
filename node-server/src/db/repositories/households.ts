import { and, count, eq, isNull } from "drizzle-orm";
import type { Db, DbExecutor } from "../client.js";
import {
  households,
  inventoryItems,
  users,
  type Household,
  type User,
  type UserRole,
} from "../schema/index.js";
import * as authSessionsRepo from "./authSessions.js";
import * as oauthRepo from "./oauthAccounts.js";
import * as usersRepo from "./users.js";

export function deriveHouseholdName(email: string): string {
  const local = email.trim().split("@")[0]?.trim();
  return local && local.length > 0 ? local : "Household";
}

export async function createHousehold(
  db: DbExecutor,
  input: { name: string; address?: string | null },
): Promise<Household> {
  const [row] = await db
    .insert(households)
    .values({ name: input.name, address: input.address ?? null })
    .returning();
  return row!;
}

export async function getHouseholdById(db: DbExecutor, id: string): Promise<Household | null> {
  const [row] = await db.select().from(households).where(eq(households.id, id)).limit(1);
  return row ?? null;
}

export async function lockHousehold(db: DbExecutor, householdId: string): Promise<void> {
  await db.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
}

export async function updateHousehold(
  db: DbExecutor,
  id: string,
  patch: { name?: string; address?: string | null },
): Promise<Household> {
  const [row] = await db
    .update(households)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(households.id, id))
    .returning();
  return row!;
}

export interface NewAccount {
  email: string;
  passwordHash?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  household?: { name: string; address?: string | null };
}

export async function createUserWithHousehold(
  db: DbExecutor,
  input: NewAccount,
): Promise<{ user: User; household: Household }> {
  const household = await createHousehold(db, {
    name: input.household?.name ?? deriveHouseholdName(input.email),
    address: input.household?.address ?? null,
  });

  const user = await usersRepo.createUser(db, {
    householdId: household.id,
    email: input.email,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    emailVerified: input.emailVerified,
    role: "admin",
    skipHousehold: input.household === undefined,
  });

  return { user, household };
}

export async function createUserInHousehold(
  db: DbExecutor,
  householdId: string,
  input: Omit<NewAccount, "household">,
): Promise<User> {
  return usersRepo.createUser(db, {
    householdId,
    email: input.email,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    emailVerified: input.emailVerified,
    role: "user",
    skipHousehold: false,
  });
}

export async function countMembers(db: DbExecutor, householdId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.householdId, householdId), isNull(users.deletedAt)));
  return row?.n ?? 0;
}

export async function countByRole(
  db: DbExecutor,
  householdId: string,
  role: UserRole,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(
      and(eq(users.householdId, householdId), eq(users.role, role), isNull(users.deletedAt)),
    );
  return row?.n ?? 0;
}

export async function deletePrivateItemsFor(
  db: DbExecutor,
  householdId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(inventoryItems)
    .where(
      and(
        eq(inventoryItems.householdId, householdId),
        eq(inventoryItems.addedByUserId, userId),
        eq(inventoryItems.isPrivate, true),
      ),
    );
}

export async function getMember(
  db: DbExecutor,
  householdId: string,
  userId: string,
): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.householdId, householdId), isNull(users.deletedAt)))
    .limit(1);
  return row ?? null;
}

export type RoleChange =
  | { status: "ok"; user: User }
  | { status: "not_a_member" }
  | { status: "last_admin" };

export async function setMemberRole(
  db: Db,
  householdId: string,
  userId: string,
  role: UserRole,
): Promise<RoleChange> {
  return db.transaction(async (tx) => {
    await lockHousehold(tx, householdId);

    const member = await getMember(tx, householdId, userId);
    if (!member) return { status: "not_a_member" };
    if (member.role === role) return { status: "ok", user: member };

    if (role === "user" && (await countByRole(tx, householdId, "admin")) === 1) {
      return { status: "last_admin" };
    }

    return { status: "ok", user: await usersRepo.updateUser(tx, userId, { role }) };
  });
}

async function moveToOwnHousehold(tx: DbExecutor, member: User): Promise<{ user: User; household: Household }> {
  await deletePrivateItemsFor(tx, member.householdId, member.id);

  const household = await createHousehold(tx, {
    name: deriveHouseholdName(member.email),
    address: null,
  });

  const user = await usersRepo.updateUser(tx, member.id, {
    householdId: household.id,
    role: "admin",
    skipHousehold: true,
  });

  return { user, household };
}

export type Removal = { status: "ok"; user: User } | { status: "not_a_member" };

export async function removeMember(db: Db, householdId: string, userId: string): Promise<Removal> {
  return db.transaction(async (tx) => {
    await lockHousehold(tx, householdId);

    const member = await getMember(tx, householdId, userId);
    if (!member) return { status: "not_a_member" };

    const { user } = await moveToOwnHousehold(tx, member);
    return { status: "ok", user };
  });
}

export interface Departure {
  user: User;
  household: Household;
  previousHouseholdDestroyed: boolean;
}

export async function leaveHousehold(db: Db, userId: string): Promise<Departure | null> {
  return db.transaction(async (tx) => {
    const member = await usersRepo.getUserById(tx, userId);
    if (!member) return null;

    const previousHouseholdId = member.householdId;
    await lockHousehold(tx, previousHouseholdId);

    const dissolves =
      member.role === "admin" && (await countByRole(tx, previousHouseholdId, "admin")) === 1;

    const { user, household } = await moveToOwnHousehold(tx, member);
    if (dissolves) await destroyHousehold(tx, previousHouseholdId);

    return { user, household, previousHouseholdDestroyed: dissolves };
  });
}

export async function destroyHousehold(db: DbExecutor, householdId: string): Promise<void> {
  // Items then occupants then the household row: both `added_by_user_id` and
  // `users.household_id` are RESTRICT, so each delete is blocked until the
  // references above it are gone.
  await db.delete(inventoryItems).where(eq(inventoryItems.householdId, householdId));

  const occupants = await db.select().from(users).where(eq(users.householdId, householdId));
  for (const occupant of occupants) {
    await moveToOwnHousehold(db, occupant);
  }

  await db.delete(households).where(eq(households.id, householdId));
}

export type AccountDeletion = "soft_deleted" | "household_destroyed";

export async function deleteAccount(db: Db, userId: string): Promise<AccountDeletion> {
  return db.transaction(async (tx) => {
    const user = await usersRepo.getUserById(tx, userId);
    if (!user) return "soft_deleted";

    await lockHousehold(tx, user.householdId);

    const dissolves =
      user.role === "admin" && (await countByRole(tx, user.householdId, "admin")) === 1;

    if (dissolves) {
      await destroyHousehold(tx, user.householdId);
    } else {
      await deletePrivateItemsFor(tx, user.householdId, user.id);
    }

    await oauthRepo.unlinkAll(tx, user.id);
    await authSessionsRepo.revokeAllForUser(tx, user.id);
    await usersRepo.softDeleteUser(tx, user.id);
    return dissolves ? "household_destroyed" : "soft_deleted";
  });
}
