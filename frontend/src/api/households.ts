import { Household, HouseholdDetail, HouseholdMember, User } from "../types";
import { apiFetch } from "./client";

type WireMember = Omit<HouseholdMember, "status">;

const withStatus = (member: WireMember): HouseholdMember => ({ ...member, status: "active" });

export async function getHousehold(): Promise<HouseholdDetail> {
  return apiFetch<HouseholdDetail>("/households");
}

export async function updateHousehold(patch: {
  name?: string;
  address?: string | null;
}): Promise<Household> {
  return apiFetch<Household>("/households", { method: "PATCH", body: patch });
}

export async function listMembers(): Promise<HouseholdMember[]> {
  const { members } = await apiFetch<{ members: WireMember[] }>("/households/members");
  return members.map(withStatus);
}

export async function setMemberRole(
  userId: string,
  role: "admin" | "user",
): Promise<HouseholdMember> {
  const member = await apiFetch<WireMember>(`/households/members/${userId}/role`, {
    method: "PATCH",
    body: { role },
  });
  return withStatus(member);
}

export async function removeMember(userId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/households/members/${userId}`, { method: "DELETE" });
}

export async function leaveHousehold(): Promise<{
  household: Household;
  user: User;
  previous_household_destroyed: boolean;
}> {
  return apiFetch("/households/leave", { method: "POST" });
}

export async function deleteHousehold(): Promise<{ user: User }> {
  return apiFetch("/households", { method: "DELETE" });
}

export async function createHousehold(input: {
  name: string;
  address?: string | null;
}): Promise<{ household: Household; user: User }> {
  return apiFetch("/households", {
    method: "POST",
    body: { name: input.name, address: input.address ?? null },
  });
}
