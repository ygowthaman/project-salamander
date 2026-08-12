import { db } from "../db/client.js";
import * as householdsRepo from "../db/repositories/households.js";
import * as usersRepo from "../db/repositories/users.js";
import type { Household, User, UserRole } from "../db/schema/index.js";

export class HouseholdError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "HouseholdError";
  }
}

function requireAdmin(actor: User): void {
  if (actor.role !== "admin") {
    throw new HouseholdError(403, "Only an admin of this household can do that");
  }
}

export interface HouseholdSummary {
  household: Household;
  memberCount: number;
  adminCount: number;
  isLastAdmin: boolean;
}

export async function getHousehold(actor: User): Promise<HouseholdSummary> {
  const household = await householdsRepo.getHouseholdById(db, actor.householdId);
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

export async function updateHousehold(
  actor: User,
  patch: { name?: string; address?: string | null },
): Promise<Household> {
  return householdsRepo.updateHousehold(db, actor.householdId, patch);
}

export async function listMembers(actor: User): Promise<User[]> {
  const members = await usersRepo.listMembers(db, actor.householdId);
  return members.sort((a, b) => {
    if (a.role !== b.role) return a.role === "admin" ? -1 : 1;
    return (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email);
  });
}

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

export async function removeMember(actor: User, userId: string): Promise<User> {
  requireAdmin(actor);

  if (userId === actor.id) {
    throw new HouseholdError(400, "Use POST /households/leave to leave the household yourself");
  }

  const outcome = await householdsRepo.removeMember(db, actor.householdId, userId);
  if (outcome.status === "not_a_member") {
    throw new HouseholdError(404, "No such member of this household");
  }
  return outcome.user;
}

export async function leaveHousehold(actor: User): Promise<householdsRepo.Departure> {
  const departure = await householdsRepo.leaveHousehold(db, actor.id);
  if (!departure) {
    throw new HouseholdError(404, "Household not found");
  }
  return departure;
}

export async function deleteHousehold(actor: User): Promise<User> {
  requireAdmin(actor);

  return db.transaction(async (tx) => {
    await householdsRepo.destroyHousehold(tx, actor.householdId);

    const user = await usersRepo.getUserById(tx, actor.id);
    if (!user) {
      throw new HouseholdError(404, "Household not found");
    }
    return user;
  });
}
