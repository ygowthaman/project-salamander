import { db } from "../db/client.js";
import * as householdsRepo from "../db/repositories/households.js";
import * as usersRepo from "../db/repositories/users.js";
import type { Household, User, UserRole } from "../db/schema/index.js";

/**
 * The household module's domain logic (PRD §2.2, §2.3).
 *
 * This layer owns the rules; `api/households.ts` owns HTTP. The split matters
 * here more than it usually would, because almost every rule in this module is
 * an authority check, and an authority check that lives in a route handler is
 * one a second caller — the interpreter, a background job — can reach the
 * database without.
 *
 * Two things are deliberately NOT in this file:
 *
 *   - **The household id.** It is never an argument. Every function takes the
 *     authenticated `User` and reads `actor.householdId` off it, so there is no
 *     parameter a caller could fill from a request body or an LLM response. That
 *     is the same binding rule the domain tables have (`db/DB_CONTEXT.md`),
 *     expressed as an absent parameter rather than as a convention.
 *   - **Multi-household reasoning.** A user belongs to exactly one household, so
 *     "their role" and "their role in this household" coincide and `actor.role`
 *     is a complete answer. If membership ever becomes many-to-many, every
 *     `requireAdmin` below becomes a lookup rather than a field read.
 *
 * Not built here: **invitations** (PRD §2.2.6). They need a table this schema
 * does not have — a household, an invited email, a single-use token, a 24-hour
 * expiry — and the two halves of the flow are blocked on things that do not
 * exist yet: the emailed link needs SMTP, and the existing-account variant needs
 * the notifications module. Everything else in §2.2 and §2.3 is implemented.
 */

/**
 * A rule this module enforces, carrying the status the boundary should report.
 *
 * Thrown rather than returned because these are exceptional in the ordinary
 * sense — every one of them means the caller asked for something they may not
 * have — and a `Result` on eight functions would put a match statement in every
 * route for the case that almost never happens.
 */
export class HouseholdError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "HouseholdError";
  }
}

/**
 * Every admin-gated action in the product (PRD §2.3.1): inviting, removing,
 * deleting the household, and changing a role. Everything else is available to
 * both roles — including renaming the household, which is not on that list and
 * so is deliberately not gated here.
 *
 * **Administration is not visibility.** Nothing in this module grants an admin a
 * view of another member's private items; that limit lives in the inventory
 * reads, and the role must never be consulted there.
 */
function requireAdmin(actor: User): void {
  if (actor.role !== "admin") {
    throw new HouseholdError(403, "Only an admin of this household can do that");
  }
}

export interface HouseholdSummary {
  household: Household;
  memberCount: number;
  adminCount: number;
  /**
   * Whether leaving or deleting this account would take the household with it
   * (PRD §2.2.8, §2.2.10) — its inventory and its records, though not anyone's
   * account. Surfaced so the UI can warn a departing admin *before* they act —
   * the leave itself is unconditional, because the PRD asks for a warning rather
   * than a second confirmation on the wire.
   */
  isLastAdmin: boolean;
}

export async function getHousehold(actor: User): Promise<HouseholdSummary> {
  const household = await householdsRepo.getHouseholdById(db, actor.householdId);
  // `users.household_id` is NOT NULL against a RESTRICT foreign key, so a
  // signed-in user whose household is missing is a broken invariant rather than
  // a 404 anyone should see. Reported as one anyway instead of throwing past
  // the boundary as a 500 with no detail.
  if (!household) {
    throw new HouseholdError(404, "Household not found");
  }

  const [memberCount, adminCount] = await Promise.all([
    householdsRepo.countMembers(db, actor.householdId),
    householdsRepo.countByRole(db, actor.householdId, "admin"),
  ]);

  return {
    household,
    memberCount,
    adminCount,
    isLastAdmin: actor.role === "admin" && adminCount === 1,
  };
}

/**
 * "Creating a household" (PRD §2.2.1, §2.2.4) — which is a rename, never an
 * insert.
 *
 * From the user's point of view this is the create form, whether they are seeing
 * it on first entry or reaching it later on their own initiative. Internally
 * nothing is created: the household they were silently given at sign-up already
 * owns their inventory and their spending history, so an insert here would mean
 * re-parenting all of it onto a new row, or leaving it behind on the old one.
 * Updating the row they already have means there is no moment at which a user's
 * data has to move.
 *
 * `skip_household` is cleared in the same transaction, because the two together
 * are the whole change: the data was already there, and what actually happens
 * is that the user now knows about it.
 *
 * Refused for a user who is already past this step. Someone who joined by
 * invitation is in a household they did not create and may not rename out from
 * under the people already in it via the create form; someone who created one
 * uses the ordinary update below. Both sit at `skip_household` false, which is
 * exactly the distinction the flag records.
 */
export async function createHousehold(
  actor: User,
  input: { name: string; address?: string | null },
): Promise<{ household: Household; user: User }> {
  if (!actor.skipHousehold) {
    throw new HouseholdError(409, "This user already belongs to a household they created or joined");
  }

  return db.transaction(async (tx) => {
    const household = await householdsRepo.updateHousehold(tx, actor.householdId, {
      name: input.name,
      address: input.address ?? null,
    });
    const user = await usersRepo.updateUser(tx, actor.id, { skipHousehold: false });
    return { household, user };
  });
}

/**
 * Renames or re-addresses an existing household, from the management page.
 *
 * Open to both roles on purpose: PRD §2.3.1 grants the admin role four powers —
 * invite, remove, delete the household, change a role — and states that
 * everything else is available to both. Editing the name is not on that list, so
 * gating it here would be inventing a fifth.
 */
export async function updateHousehold(
  actor: User,
  patch: { name?: string; address?: string | null },
): Promise<Household> {
  return householdsRepo.updateHousehold(db, actor.householdId, patch);
}

/**
 * The household's members, admins first and then by name, so the list has a
 * stable order the UI does not have to impose.
 *
 * Active members only — a soft-deleted row survives to put a name on the items
 * that person added, and is not somebody who is still in the household.
 */
export async function listMembers(actor: User): Promise<User[]> {
  const members = await usersRepo.listMembers(db, actor.householdId);
  return members.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email);
  });
}

/**
 * Promotes or demotes a member (PRD §2.3.3) — an `admin` action.
 *
 * Any admin may change any member's role, including another admin's and their
 * own. There is no primary admin and no founder: once there are two they are
 * peers, and either may remove the other's role. The alternative — a permanent
 * creator who cannot be displaced — leaves a household under the control of
 * someone who has moved out, with no way for the people still living there to
 * take it back.
 *
 * The one refusal is the invariant: a household always has at least one admin,
 * so demoting the last one is not possible. That check is inside the
 * repository's transaction, not here, because reading the count in this function
 * and acting on it in another statement is exactly the race it has to exclude.
 */
export async function setMemberRole(actor: User, userId: string, role: UserRole): Promise<User> {
  requireAdmin(actor);

  const outcome = await householdsRepo.setMemberRole(db, actor.householdId, userId, role);
  switch (outcome.status) {
    case "not_a_member":
      throw new HouseholdError(404, "No such member of this household");
    case "last_admin":
      throw new HouseholdError(409, "A household must always have at least one admin");
    case "ok":
      return outcome.user;
  }
}

/**
 * Removes a member (PRD §2.2.10) — an `admin` action.
 *
 * Removal and leaving are the same operation with a different instigator, so
 * everything that happens to a departing member happens here unchanged: they
 * take nothing with them, their private items are deleted, and they land as the
 * sole admin of a new household of their own. Any member can be removed,
 * including another admin.
 *
 * Removing *yourself* is refused, and not because it would be dangerous — it is
 * the one case where the two instigators genuinely differ. Leaving can dissolve
 * the household (§2.2.10) and comes with a warning first; removal never can,
 * precisely because an admin is always left behind. Routing self-removal through
 * `leaveHousehold` keeps that guarantee true rather than making it conditional.
 *
 * TODO(notifications): a removed member is meant to be told, since they did not
 * choose this and would otherwise discover it by finding their household gone.
 * The notifications module is not written; this is where that call belongs.
 */
export async function removeMember(actor: User, userId: string): Promise<User> {
  requireAdmin(actor);

  if (userId === actor.id) {
    throw new HouseholdError(400, "Use POST /household/leave to leave the household yourself");
  }

  const outcome = await householdsRepo.removeMember(db, actor.householdId, userId);
  if (outcome.status === "not_a_member") {
    throw new HouseholdError(404, "No such member of this household");
  }
  return outcome.user;
}

/**
 * The caller leaves their household (PRD §2.2.10). Available to both roles.
 *
 * They keep their account and their identity, and land in a new household of
 * their own, back in the state of a user who skipped the household step. If they
 * were the last admin the household they left is dissolved behind them and its
 * inventory destroyed — everyone still in it keeps their account and is re-homed
 * the same way the leaver was.
 *
 * **No confirmation is required on the wire, and that is the PRD's choice, not
 * an omission.** The departing admin is to be *warned* — told that leaving will
 * delete the household — which is a thing the interface does before calling
 * this, using `isLastAdmin` from `getHousehold`. A second confirm parameter here
 * would be a different rule than the one specified.
 */
export async function leaveHousehold(actor: User): Promise<householdsRepo.Departure> {
  const departure = await householdsRepo.leaveHousehold(db, actor.id);
  if (!departure) {
    throw new HouseholdError(404, "Household not found");
  }
  return departure;
}

/**
 * Deletes the household and everything it owns (PRD §2.2.8) — an `admin` action,
 * and the only operation in the product that genuinely destroys data.
 *
 * It takes the inventory, the categories and the records. **It does not take
 * anyone's account** — not the caller's and not any other member's. Everyone in
 * it keeps their sign-in and lands in a silent household of their own, exactly
 * as a departing member does (§2.2.10). Deleting a household is destroying a
 * shared thing, not evicting the people who shared it.
 *
 * Membership and role are both required, which is what taking the household id
 * from the actor rather than from the request guarantees: the check is always
 * "admin *of this household*", never "is an admin".
 *
 * The caller's re-homed row comes back so the boundary can hand it to the SPA.
 * Their session stays valid — the account behind it is untouched — but it now
 * resolves to a different household, and a client still holding the old user
 * would render a household that no longer exists.
 *
 * No extra confirmation beyond the ordinary one the UI puts on a destructive
 * button. Notably, a user who skipped the household step is not warned that a
 * household is going with them — they do not know they have one, and raising it
 * at the moment of deletion would introduce the concept purely to alarm them.
 */
export async function deleteHousehold(actor: User): Promise<User> {
  requireAdmin(actor);

  // One transaction because `destroyHousehold` is a sequence — inventory, then
  // every member onto a new household, then the row — and a failure part way
  // through would leave members scattered out of a household that still exists.
  return db.transaction(async (tx) => {
    await householdsRepo.destroyHousehold(tx, actor.householdId);

    // Re-read rather than returned from the teardown: it re-homes every occupant
    // and has no reason to single one out, and this is the only caller that
    // cares which row was the caller's.
    const user = await usersRepo.getUserById(tx, actor.id);
    if (!user) {
      throw new HouseholdError(404, "Household not found");
    }
    return user;
  });
}
