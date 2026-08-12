export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  created_at: string;
  has_password?: boolean;
  linked_providers?: string[];
  household_id: string;
  skip_household: boolean;
  role: "admin" | "user";
}

export interface Household {
  id: string;
  name: string;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface HouseholdDetail extends Household {
  member_count: number;
  admin_count: number;
  role: "admin" | "user";
  skip_household: boolean;
  is_last_admin: boolean;
}

export type HouseholdMemberStatus = "active" | "invited";

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

export interface Category {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ItemAuthor {
  id: string;
  name: string;
}

export interface InventoryItem {
  id: string;
  category_id: string;
  name: string;
  unit: string | null;
  quantity: number | null;
  attributes: string | null;
  added_by: ItemAuthor;
  is_private: boolean;
  created_at: string;
  last_updated: string;
}

export interface InventoryCategoryGroup {
  category: { id: string; name: string };
  items: InventoryItem[];
}

export interface InventoryGrouped {
  groups: InventoryCategoryGroup[];
}

export interface ProposedItem {
  name: string;
  category_id: string;
  unit: string | null;
  quantity: number;
  attributes: string | null;
  is_private: boolean;
}

export type ProposedChanges = Partial<{
  name: string;
  category_id: string;
  unit: string;
  quantity: number;
  attributes: string;
  is_private: boolean;
}>;

export type Interpretation =
  | { type: "question"; question: string; items?: InventoryItem[] }
  | { type: "items"; items: InventoryItem[]; total: number }
  | { type: "create_proposal"; item: ProposedItem }
  | { type: "update_proposal"; item: InventoryItem; changes: ProposedChanges }
  | { type: "delete_proposal"; item: InventoryItem };
