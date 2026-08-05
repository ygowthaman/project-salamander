import { Household, HouseholdDetail, HouseholdMember, User } from "../types";
import { apiFetch } from "./client";

/**
 * The server has no `status` column to send: invitations have no storage, so
 * anyone it can return is a member who has joined. Stamped on here rather than
 * left undefined so the table renders one shape and its disabled states read
 * from data — see `HouseholdMemberStatus`.
 */
type WireMember = Omit<HouseholdMember, "status">;

const withStatus = (member: WireMember): HouseholdMember => ({ ...member, status: "active" });

export async function getHousehold(): Promise<HouseholdDetail> {
  return apiFetch<HouseholdDetail>("/household");
}

/**
 * Renames or re-addresses the household. Open to both roles: the admin role
 * governs who is in the household and whether it continues to exist, and this
 * is neither.
 */
export async function updateHousehold(patch: {
  name?: string;
  address?: string | null;
}): Promise<Household> {
  return apiFetch<Household>("/household", { method: "PATCH", body: patch });
}

export async function listMembers(): Promise<HouseholdMember[]> {
  const { members } = await apiFetch<{ members: WireMember[] }>("/household/members");
  return members.map(withStatus);
}

/**
 * Promotes or demotes a member. Admin only, and any admin may change any
 * member's role including their own — there is no founder and no protected
 * first admin.
 *
 * 409 when it would leave the household with no admin at all. That is the one
 * refusal, and it applies to demoting yourself exactly as it does to demoting
 * someone else.
 */
export async function setMemberRole(
  userId: string,
  role: "admin" | "user",
): Promise<HouseholdMember> {
  const member = await apiFetch<WireMember>(`/household/members/${userId}/role`, {
    method: "PATCH",
    body: { role },
  });
  return withStatus(member);
}

/**
 * Removes a member. Admin only, and never yourself — leaving is a separate
 * operation because only leaving can dissolve the household.
 *
 * Nothing of theirs is destroyed except the items they marked private: they keep
 * their account and land in a household of their own, and everything else they
 * added stays behind. Ownership belongs to the household, so a departure never
 * converts any of it into personal property.
 */
export async function removeMember(userId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/household/members/${userId}`, { method: "DELETE" });
}

/**
 * The caller leaves their household. Available to both roles.
 *
 * They stay signed in: leaving is not deleting an account, so the session
 * survives and simply resolves to a different household on the next request.
 * The returned user carries the new `household_id`, `role` and `skip_household`
 * — apply it, or the app keeps rendering the household they just left.
 *
 * `previous_household_destroyed` reports the last-admin case, where the
 * household they left was dissolved behind them. It is a result, not a
 * question: the warning belongs in front of this call.
 */
export async function leaveHousehold(): Promise<{
  household: Household;
  user: User;
  previous_household_destroyed: boolean;
}> {
  return apiFetch("/household/leave", { method: "POST" });
}

/**
 * Deletes the household and everything it owns — its inventory, its categories,
 * its records. Admin only.
 *
 * **No account is deleted, the caller's least of all.** Everyone in the
 * household keeps their sign-in and is re-homed into a silent household of their
 * own, so this is destroying a shared thing rather than evicting the people who
 * shared it. The session survives; the caller stays signed in.
 *
 * The returned user carries the new `household_id`, `role` and `skip_household`
 * — apply it, exactly as after a leave, or the app keeps rendering a household
 * that no longer exists.
 */
export async function deleteHousehold(): Promise<{ user: User }> {
  return apiFetch("/household", { method: "DELETE" });
}

/**
 * "Creating a household" — the setup form, whether it is answered on first entry
 * or reached later from the account menu.
 *
 * Despite the name and the POST, **nothing is created**. Every account already
 * has a household: one is provisioned silently at sign-up so that there is
 * exactly one shape of ownership in the system rather than two. This renames the
 * row the user already has and clears `skip_household` on them, which is why the
 * response carries the updated user as well — the caller must put it back into
 * auth state or the UI keeps treating them as someone without a household.
 *
 * The upshot for the client is that enabling a household never moves any data:
 * whatever inventory the user has already accumulated stays exactly where it is.
 *
 * 409 when the user is already past this step — they created a household or
 * joined one by invitation, and renaming from this form would let them rename
 * one out from under the people already in it.
 */
export async function createHousehold(input: {
  name: string;
  address?: string | null;
}): Promise<{ household: Household; user: User }> {
  return apiFetch("/household", {
    method: "POST",
    body: { name: input.name, address: input.address ?? null },
  });
}
