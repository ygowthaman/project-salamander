export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  created_at: string;
  /** False for accounts that only ever signed in with Google. */
  has_password?: boolean;
  linked_providers?: string[];
  /**
   * Every user always belongs to exactly one, so this is never null and no view
   * needs a "no household" branch. A user who skipped the setup form was given
   * one silently and does not know it exists.
   */
  household_id: string;
  /**
   * Whether the household was provisioned silently (true) or deliberately
   * created/joined (false).
   *
   * **This is what the UI branches on, and it is not a "has the form been shown"
   * flag.** The data is identical either way; what differs is the user's
   * understanding. Someone at `true` must not be shown household features, a
   * member list, or a name they never chose. Deciding whether to *ask* is a
   * different question — that follows account creation, not this — because a
   * user who skipped and one who was never asked both sit here at `true`.
   */
  skip_household: boolean;
  /** Their role within that household. Admin-only actions are gated server-side. */
  role: "admin" | "user";
}

/** One `households` row as the API serialises it. */
export interface Household {
  id: string;
  name: string;
  /** Optional, and a household without one is normal rather than incomplete. */
  address: string | null;
  created_at: string;
  updated_at: string;
}

/** `GET /household` — the household, plus where the caller stands in it. */
export interface HouseholdDetail extends Household {
  member_count: number;
  admin_count: number;
  /** The caller's own role. Admin-gated actions are enforced server-side too. */
  role: "admin" | "user";
  skip_household: boolean;
  /**
   * True when the caller is the only admin, so leaving — or deleting their
   * account — would dissolve the household and destroy everything it was
   * tracking. Nobody's account goes with it: every other member keeps their
   * sign-in and starts fresh on their own. What the UI warns on before either
   * action.
   */
  is_last_admin: boolean;
}

/**
 * Where a member stands in the household.
 *
 * `invited` is **not reachable today**: invitations have no table, no endpoint
 * and no email to send, so every member the server can return is someone who has
 * joined. It is modelled anyway because the members table disables role changes
 * for anyone who has not yet accepted — keeping that a data question rather than
 * a missing concept means invitations land as a serialiser change, not a rewrite
 * of this screen.
 */
export type HouseholdMemberStatus = "active" | "invited";

/** One member as `GET /household/members` serialises them. */
export interface HouseholdMember {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: "admin" | "user";
  is_self: boolean;
  created_at: string;
  status: HouseholdMemberStatus;
}

/** One `inventory_items` row as the API serialises it. */
export interface InventoryItem {
  id: string;
  category_id: string;
  name: string;
  /** Free text — nothing joins on a unit, so "dozen" and "dozens" can coexist. */
  unit: string | null;
  /** Null means "tracked, count unknown" — a real state, and not the same as 0. */
  quantity: number | null;
  /** Open-ended per item type (author/edition/isbn, model number, …). */
  attributes: Record<string, unknown> | null;
  created_at: string;
  /** When the *stock* last moved, which is what the card shows. */
  last_updated: string;
}

/** The items of one category, as returned by `GET /inventory?groupBy=category`. */
export interface InventoryCategoryGroup {
  category: { id: string; name: string };
  items: InventoryItem[];
}

export interface InventoryGrouped {
  group_by: "category";
  groups: InventoryCategoryGroup[];
}
