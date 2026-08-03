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

/**
 * The household row, plus the account lifecycle that has to move with it.
 *
 * Auto-provisioning lives here rather than in the auth routes so that *no* code
 * path can insert a `users` row without a household: `createUserWithHousehold`
 * is the only supported way to make an account, and it writes both rows in one
 * transaction. Because UUIDs are app-generated, the household id exists before
 * either insert, so there is no nullable-then-backfill window.
 */

/**
 * The name a household gets when the user skipped the create form (PRD §2.2.5):
 * everything before the `@` in their email.
 *
 * The email and not the display name, which is optional and may be absent —
 * email is mandatory on every account, so this derivation always has an input.
 */
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

/**
 * Takes a row lock on the household, serialising every operation that has to
 * resolve the "at least one admin" invariant (PRD §2.3.3).
 *
 * Counting admins and then acting on the count is not atomic on its own: two
 * concurrent demotions of two different admins would each see a count of two,
 * each conclude it was safe, and between them leave the household with none.
 * Every such transaction takes this lock first, so they queue instead. The
 * household row is the lock object rather than the `users` rows because the
 * membership set is exactly what is being changed.
 */
export async function lockHousehold(db: DbExecutor, householdId: string): Promise<void> {
  await db.select({ id: households.id }).from(households).where(eq(households.id, householdId)).for("update");
}

/**
 * "Creating a household later" (PRD §2.2.4) is this, plus clearing
 * `skip_household` on the user — an UPDATE of the row they already have, never
 * an INSERT. The existing row already owns their inventory and spending
 * history, so enabling a household is a rename and never a migration; there is
 * no moment at which a user's data has to be re-parented.
 */
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
  /**
   * Supplied only when the user filled in the create form at sign-up. Absent
   * means they skipped it (or were never in a position to be asked), which is
   * what `skip_household` records — see PRD §2.2.3.
   */
  household?: { name: string; address?: string | null };
}

/**
 * Creates an account and the household that owns its data, in one transaction.
 *
 * Whoever creates a household is its admin, and that covers the skip case too:
 * the user is the only member, so there is nobody to administer and the role is
 * a label they never see (PRD §2.3.2). Nothing about skipping is special-cased.
 */
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
    // True when we made the household for them: the data is identical either
    // way, and this is the only thing that tells the UI whether the user knows
    // they have one.
    skipHousehold: input.household === undefined,
  });

  return { user, household };
}

/**
 * Creates an account directly inside an existing household — the invitation
 * path (PRD §2.2.6), and the one route by which a user gets no household of
 * their own. They join as `user`; admin is conferred only by creating a
 * household or by an existing admin granting it (§2.3.2).
 *
 * `skip_household` is false: the household was fixed before the account
 * existed, named in the invitation they accepted, so there was nothing to skip.
 */
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

/** Active members only — a soft-deleted row is a name on old entries, not a member. */
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

/**
 * Deletes the private items one member added (PRD §2.2.9).
 *
 * Every departure path runs this — soft delete, leaving, being removed — for
 * the same reason: an item only its author could see has no audience once they
 * are gone, and leaving it behind would put rows in the household's inventory
 * that no remaining member, not even an admin, could read or remove. Nothing
 * private is ever inherited by the household or carried to another one.
 *
 * Here rather than in an inventory repository because it is a membership
 * concern, not a stock one; move it if the inventory module ever grows a
 * reason to own it.
 */
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

/**
 * One active member of one household.
 *
 * Scoped by household in the query itself rather than fetched and then checked,
 * so a user id from another household 404s without a second ownership branch a
 * call site can forget to write. That is also the response the PRD wants: a role
 * carries no authority outside its holder's own household (§2.3.1), so an admin
 * asking about a member of another one is asking about someone who, as far as
 * they are concerned, does not exist.
 */
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

/**
 * Changes one member's role (PRD §2.3.3).
 *
 * Any admin may change any member's role, including another admin's and their
 * own — there is no primary admin, no owner and no founder, so the member who
 * created the household holds nothing the others lack. The single limit is the
 * invariant: **every household must always have at least one admin**, so a
 * demotion that would leave none is refused rather than resolved some other way.
 * Demoting yourself is subject to exactly the same check, which is why the count
 * is of the household's admins and not of "other" admins.
 *
 * The count and the update share a transaction *and* the household lock, or two
 * simultaneous demotions each see the other's admin and both proceed.
 */
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

/**
 * Moves a member out of the household they are in and into a fresh one of their
 * own (PRD §2.2.10). The shared half of leaving and being removed — the two are
 * the same operation with a different instigator, and nothing below varies by
 * which one it was.
 *
 * Three things happen, and the order of the first two matters:
 *
 *   1. **Their private items are deleted.** An item only its author could see
 *      has no audience once they are gone, and leaving it behind would put rows
 *      in the household's inventory that no remaining member — not even an
 *      admin — could read or remove. This must happen while they are still
 *      pointed at the old household, because that is the scope it deletes in.
 *   2. **A household is created for them and they are moved onto it.** Nobody is
 *      ever without one, so a departure is a move rather than an eviction into
 *      nothing. Everything else they added stays behind: ownership belongs to
 *      the household, and leaving does not convert any of it into personal
 *      property. The new row starts empty and nothing is re-parented onto it.
 *   3. **They land exactly where a user who skipped the household step sits** —
 *      `skip_household` back to true and `admin` of the new household, because a
 *      sole member is always the sole admin (§2.3.2).
 */
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

/**
 * Removes a member from a household — an `admin` action (PRD §2.3.1).
 *
 * **Removal can never dissolve the household**, which is why this has no
 * last-admin branch and `leaveHousehold` below does. Only an admin can remove
 * someone and the API refuses self-removal (leaving is its own operation), so
 * the instigator is always an admin who is still a member afterwards. Any member
 * may be removed, including another admin — admins are not protected from one
 * another, consistent with §2.3.3.
 *
 * The removed member is meant to be told, since they did not choose this. That
 * is the notifications module, which is not built; see the note in the service.
 */
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
  /**
   * True when the departing member was the last admin, so the household they
   * left was destroyed behind them — along with every member still in it. The
   * UI is expected to have warned them first (PRD §2.2.10).
   */
  previousHouseholdDestroyed: boolean;
}

/**
 * A member leaves the household they are in (PRD §2.2.10), keeping their
 * account, their credentials and their identity.
 *
 * **When the last admin leaves, the household is deleted** — totally, including
 * its inventory and the accounts of every member still in it. A household with
 * no admin is not a state the system allows, and a departure that would produce
 * one dissolves the household instead of being refused. The person leaving is
 * unaffected: they move into their own new household exactly as anyone else
 * does. Note that a sole member is always the sole admin, so leaving a household
 * you were alone in always dissolves it and no empty household is left behind.
 *
 * The order is load-bearing twice over. The leaver is moved onto their new
 * household **before** the old one is destroyed, because `destroyHousehold`
 * deletes every user still pointing at it — reverse the two and leaving would
 * delete the account of the person who only wanted out. And within the teardown,
 * members go before the household row, since `users.household_id` is RESTRICT.
 */
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

/**
 * Destroys a household and everything it owns, including the accounts of every
 * member still in it (PRD §2.2.8). The only operation in the product that
 * genuinely destroys data.
 *
 * Members are hard-deleted FIRST: `users.household_id` is ON DELETE RESTRICT,
 * so the household row cannot go while anyone still points at it. That ordering
 * is load-bearing, not incidental — reverse it and the delete fails with a
 * foreign-key violation. Everything else (categories, inventory, events,
 * mandates) is CASCADE off the household, so dropping the row takes it along.
 */
export async function destroyHousehold(db: DbExecutor, householdId: string): Promise<void> {
  await db.delete(users).where(eq(users.householdId, householdId));
  await db.delete(households).where(eq(households.id, householdId));
}

export type AccountDeletion = "soft_deleted" | "household_destroyed";

/**
 * Deletes a user's account, resolving what that means for their household.
 *
 * The two outcomes are the asymmetry in PRD §2.2.8, and the choice between them
 * is the last-admin check — which a RESTRICT foreign key cannot express, so it
 * has to happen here, inside the transaction:
 *
 *   - **Ordinarily, a soft delete.** The account is retired and every way back
 *     into it is destroyed, but the row survives so the household keeps a
 *     complete history of who added what. Their private items go with them.
 *   - **When they are the last admin, the household goes too** — totally,
 *     including every remaining member's account. Every household must always
 *     have at least one admin, and account deletion is the one operation that
 *     resolves that invariant by the household ceasing to exist rather than by
 *     being refused. There is no delegation and nobody is prompted to hand the
 *     role over first.
 *
 * A sole member is always the sole admin, so a user who skipped the household
 * step takes their silent household with them by this same rule — no special
 * case, and nothing worth protecting is lost, because to that household nobody
 * else's attribution was ever at stake.
 */
export async function deleteAccount(db: Db, userId: string): Promise<AccountDeletion> {
  return db.transaction(async (tx) => {
    const user = await usersRepo.getUserById(tx, userId);
    if (!user) return "soft_deleted";

    // Same lock as every other resolution of the last-admin invariant: without
    // it, this deletion and a concurrent demotion could each read an admin count
    // the other is about to invalidate.
    await lockHousehold(tx, user.householdId);

    if (user.role === "admin" && (await countByRole(tx, user.householdId, "admin")) === 1) {
      await destroyHousehold(tx, user.householdId);
      return "household_destroyed";
    }

    await deletePrivateItemsFor(tx, user.householdId, user.id);
    // Retiring the account has to remove the ways back into it, not merely mark
    // it: an intact provider link would let the same person sign in again and
    // land on the retired record. `softDeleteUser` discards the password; these
    // two take the links and the live sessions.
    await oauthRepo.unlinkAll(tx, user.id);
    await authSessionsRepo.revokeAllForUser(tx, user.id);
    await usersRepo.softDeleteUser(tx, user.id);
    return "soft_deleted";
  });
}
