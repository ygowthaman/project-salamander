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
