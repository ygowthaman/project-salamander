import { type SQL, and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import {
  categories,
  inventoryItems,
  users,
  type InventoryItem,
} from "../schema/index.js";
import { categoryExists } from "./categories.js";

export function visibleTo(actorId: string): SQL {
  return or(eq(inventoryItems.isPrivate, false), eq(inventoryItems.addedByUserId, actorId))!;
}

function inScope(householdId: string, actorId: string): SQL {
  return and(eq(inventoryItems.householdId, householdId), visibleTo(actorId))!;
}

const authorName = sql<string>`coalesce(
  nullif(trim(${users.displayName}), ''),
  case when ${users.deletedAt} is null then ${users.email} else 'Former member' end
)`;

export type ItemWithAuthor = InventoryItem & {
  addedBy: { id: string; name: string };
};

export type ItemWithCategory = ItemWithAuthor & {
  category: { id: string; name: string };
};

const itemColumns = {
  item: inventoryItems,
  authorId: users.id,
  authorName,
};

function toItem(row: { item: InventoryItem; authorId: string; authorName: string }): ItemWithAuthor {
  return { ...row.item, addedBy: { id: row.authorId, name: row.authorName } };
}

function escapedLikeTerm(q: string): string {
  return `%${q.replace(/([\\%_])/g, "\\$1")}%`;
}

export interface ListFilters {
  q?: string;
  categoryId?: string;
  limit: number;
  offset: number;
}

export async function listItems(
  db: DbExecutor,
  householdId: string,
  actorId: string,
  filters: ListFilters,
): Promise<{ items: ItemWithAuthor[]; total: number }> {
  const conditions = [inScope(householdId, actorId)];
  if (filters.q) conditions.push(ilike(inventoryItems.name, escapedLikeTerm(filters.q)));
  if (filters.categoryId) conditions.push(eq(inventoryItems.categoryId, filters.categoryId));

  const rows = await db
    .select({ ...itemColumns, total: sql<number>`count(*) over ()`.mapWith(Number) })
    .from(inventoryItems)
    .innerJoin(users, eq(users.id, inventoryItems.addedByUserId))
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${inventoryItems.name})`), asc(inventoryItems.id))
    .limit(filters.limit)
    .offset(filters.offset);

  return { items: rows.map(toItem), total: rows[0]?.total ?? 0 };
}

export async function listItemsWithCategory(
  db: DbExecutor,
  householdId: string,
  actorId: string,
): Promise<ItemWithCategory[]> {
  const rows = await db
    .select({ ...itemColumns, categoryId: categories.id, categoryName: categories.name })
    .from(inventoryItems)
    .innerJoin(users, eq(users.id, inventoryItems.addedByUserId))
    .innerJoin(categories, eq(categories.id, inventoryItems.categoryId))
    .where(inScope(householdId, actorId))
    .orderBy(
      asc(sql`lower(${categories.name})`),
      asc(sql`lower(${inventoryItems.name})`),
      asc(inventoryItems.id),
    );

  return rows.map((row) => ({
    ...toItem(row),
    category: { id: row.categoryId, name: row.categoryName },
  }));
}

export async function getItem(
  db: DbExecutor,
  householdId: string,
  actorId: string,
  id: string,
): Promise<ItemWithAuthor | null> {
  const [row] = await db
    .select(itemColumns)
    .from(inventoryItems)
    .innerJoin(users, eq(users.id, inventoryItems.addedByUserId))
    .where(and(eq(inventoryItems.id, id), inScope(householdId, actorId)))
    .limit(1);
  return row ? toItem(row) : null;
}

export interface NewItem {
  name: string;
  categoryId: string;
  unit?: string | null;
  quantity?: number | null;
  attributes?: string | null;
  isPrivate?: boolean;
}

export async function createItem(
  db: DbExecutor,
  householdId: string,
  actorId: string,
  input: NewItem,
): Promise<ItemWithAuthor | null> {
  if (!(await categoryExists(db, householdId, input.categoryId))) return null;

  const [row] = await db
    .insert(inventoryItems)
    .values({
      householdId,
      addedByUserId: actorId,
      name: input.name,
      categoryId: input.categoryId,
      unit: input.unit ?? null,
      quantity: input.quantity ?? null,
      attributes: input.attributes ?? null,
      isPrivate: input.isPrivate ?? false,
    })
    .returning();

  return getItem(db, householdId, actorId, row!.id);
}

export interface ItemPatch {
  name?: string;
  categoryId?: string;
  unit?: string | null;
  quantity?: number | null;
  attributes?: string | null;
  isPrivate?: boolean;
}

export type ItemUpdate =
  | { status: "ok"; item: ItemWithAuthor }
  | { status: "not_found" }
  | { status: "unknown_category" }
  | { status: "not_the_author" };

export async function updateItem(
  db: DbExecutor,
  householdId: string,
  actorId: string,
  id: string,
  patch: ItemPatch,
): Promise<ItemUpdate> {
  const existing = await getItem(db, householdId, actorId, id);
  if (!existing) return { status: "not_found" };

  if (patch.isPrivate !== undefined && existing.addedByUserId !== actorId) {
    return { status: "not_the_author" };
  }

  if (patch.categoryId !== undefined && !(await categoryExists(db, householdId, patch.categoryId))) {
    return { status: "unknown_category" };
  }

  // Drizzle rejects a `SET` with no assignments.
  if (Object.keys(patch).length === 0) return { status: "ok", item: existing };

  await db
    .update(inventoryItems)
    .set(patch)
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.householdId, householdId)));

  return { status: "ok", item: (await getItem(db, householdId, actorId, id))! };
}

export async function deleteItem(
  db: DbExecutor,
  householdId: string,
  actorId: string,
  id: string,
): Promise<boolean> {
  const deleted = await db
    .delete(inventoryItems)
    .where(and(eq(inventoryItems.id, id), inScope(householdId, actorId)))
    .returning({ id: inventoryItems.id });
  return deleted.length > 0;
}

export type StockChange = { quantity: number } | { delta: number };

export type StockResult =
  | { status: "ok"; item: ItemWithAuthor }
  | { status: "not_found" }
  | { status: "unknown_quantity" };

export async function countItemsByCategory(
  db: DbExecutor,
  householdId: string,
  actorId: string,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ categoryId: inventoryItems.categoryId, n: count() })
    .from(inventoryItems)
    .where(inScope(householdId, actorId))
    .groupBy(inventoryItems.categoryId);

  return new Map(rows.map((row) => [row.categoryId, row.n]));
}

export async function countItemsInCategory(
  db: DbExecutor,
  householdId: string,
  actorId: string,
  categoryId: string,
): Promise<{ total: number; visible: number }> {
  const [row] = await db
    .select({
      total: count(),
      visible: sql<number>`count(*) filter (where ${visibleTo(actorId)})`.mapWith(Number),
    })
    .from(inventoryItems)
    .where(
      and(eq(inventoryItems.householdId, householdId), eq(inventoryItems.categoryId, categoryId)),
    );

  return { total: row?.total ?? 0, visible: row?.visible ?? 0 };
}

export async function applyStockChange(
  db: DbExecutor,
  householdId: string,
  actorId: string,
  id: string,
  change: StockChange,
): Promise<StockResult> {
  const existing = await getItem(db, householdId, actorId, id);
  if (!existing) return { status: "not_found" };

  if ("delta" in change && existing.quantity === null) {
    return { status: "unknown_quantity" };
  }

  const quantity =
    "quantity" in change
      ? sql<number>`${change.quantity}`
      : sql<number>`greatest(0, ${inventoryItems.quantity} + ${change.delta})`;

  await db
    .update(inventoryItems)
    .set({ quantity, lastUpdated: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.householdId, householdId)));

  return { status: "ok", item: (await getItem(db, householdId, actorId, id))! };
}
