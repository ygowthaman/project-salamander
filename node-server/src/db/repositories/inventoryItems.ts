import { type SQL, and, asc, count, eq, ilike, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import {
  categories,
  inventoryItems,
  users,
  type InventoryItem,
} from "../schema/index.js";
import { categoryExists } from "./categories.js";

/**
 * The inventory read and write paths (PRD §2.5).
 *
 * Two rules govern every function in this file, and they are different rules
 * that are easy to collapse into one:
 *
 *   - **`householdId` is the scope.** The inventory belongs to the household, so
 *     it is what every query filters on. A row in another household is not
 *     "forbidden", it is *absent*: the caller gets `null` and answers 404.
 *   - **`actorId` is not a scope.** It feeds one thing, `visibleTo` below, and
 *     narrowing rows by the actor for any other reason would mean two members of
 *     one household seeing different inventories.
 *
 * The visibility filter lives here and only here. It has to hold on three
 * surfaces — the read, the metadata handed to the model (§2.5.6), and the
 * WebSocket fan-out (§2.5.10) — and written out per call site it would be right
 * on two of them and forgotten on the third.
 */

/**
 * `NOT is_private OR added_by_user_id = me` — the whole of PRD §2.5.9's
 * visibility rule, in one place.
 *
 * **The role is deliberately not consulted.** An admin administers the household
 * and gets no privileged view of a member's things (§2.3.1), so there is no
 * branch here to add one to.
 */
export function visibleTo(actorId: string): SQL {
  return or(eq(inventoryItems.isPrivate, false), eq(inventoryItems.addedByUserId, actorId))!;
}

/** Household scope and visibility together — what every read below starts from. */
function inScope(householdId: string, actorId: string): SQL {
  return and(eq(inventoryItems.householdId, householdId), visibleTo(actorId))!;
}

/**
 * The label rendered for `added_by`, resolved in SQL so there is one definition
 * of it rather than one per consumer.
 *
 * `display_name ?? email` is the fallback the household members screen already
 * uses. The third arm is for a member who was soft-deleted without ever setting
 * a display name: their email has been replaced by a tombstone address
 * (`repositories/users.ts`), which must never reach a UI. Attribution outliving
 * the account is the entire reason that row still exists (PRD §2.2.8), so it
 * has to render as *something*.
 */
const authorName = sql<string>`coalesce(
  nullif(trim(${users.displayName}), ''),
  case when ${users.deletedAt} is null then ${users.email} else 'Former member' end
)`;

/**
 * An item with its attribution resolved to a name.
 *
 * Every read returns this rather than the bare row: `added_by_user_id` renders
 * nothing on its own, and making each consumer resolve it would put the fallback
 * rule above in several places at once.
 */
export type ItemWithAuthor = InventoryItem & {
  addedBy: { id: string; name: string };
};

/** An item that also carries its category, for the grouped read. */
export type ItemWithCategory = ItemWithAuthor & {
  category: { id: string; name: string };
};

/**
 * The author join.
 *
 * `innerJoin` on `users` with **no `deleted_at` filter**: `added_by_user_id` is
 * NOT NULL against a RESTRICT foreign key, so the row is always there, and a
 * departed member's name is exactly what this join exists to fetch. Filtering
 * retired accounts out here would silently drop their items from every read.
 */
const itemColumns = {
  item: inventoryItems,
  authorId: users.id,
  authorName,
};

function toItem(row: { item: InventoryItem; authorId: string; authorName: string }): ItemWithAuthor {
  return { ...row.item, addedBy: { id: row.authorId, name: row.authorName } };
}

/**
 * Escapes a user-typed search term for `ILIKE`.
 *
 * Without this, a `%` in the box matches everything and an `_` matches any
 * character — the search silently stops meaning what the user typed.
 */
function likeTerm(q: string): string {
  return `%${q.replace(/([\\%_])/g, "\\$1")}%`;
}

export interface ListFilters {
  /** Name substring, for the item picker. */
  q?: string;
  categoryId?: string;
  limit: number;
  offset: number;
}

/**
 * One page of items, plus the total the page was drawn from.
 *
 * `total` counts the same filtered set the page came from, so it is this
 * member's total and not the household's (§2.5.9). It is computed with a window
 * function rather than a second query, so the count and the page can never
 * disagree about what was in the table at the time.
 */
export async function listItems(
  db: DbExecutor,
  householdId: string,
  actorId: string,
  filters: ListFilters,
): Promise<{ items: ItemWithAuthor[]; total: number }> {
  const conditions = [inScope(householdId, actorId)];
  if (filters.q) conditions.push(ilike(inventoryItems.name, likeTerm(filters.q)));
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

/**
 * Every visible item with its category, ordered by category so the caller can
 * bucket it in one pass.
 *
 * Grouping is not done here and not done with `GROUP BY`: the rows themselves
 * are what the response carries, so one ordered query plus a single pass over
 * it is strictly less work than a query per group. Ordering by category first is
 * what makes that pass possible.
 *
 * Category is the only dimension the product groups by. `unit` is free text for
 * exactly this reason (PRD §2.5.1) — an inconsistency between *litres* and *L*
 * stays inside the row it was typed into precisely because nothing buckets or
 * totals on it.
 */
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

/**
 * One item, or `null`.
 *
 * `null` covers three cases on purpose — no such row, a row in another
 * household, and another member's private row — because telling them apart is
 * exactly what a 403 would do. Every `{id}` operation below funnels through this
 * scope for the same reason, so no call site has a second ownership branch it
 * can forget to write.
 */
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
  attributes?: Record<string, unknown> | null;
  isPrivate?: boolean;
}

/**
 * Creates an item. `null` means the category is not this household's — the same
 * answer a nonexistent category id gets, so a foreign id cannot be confirmed by
 * the response.
 *
 * `householdId` and `addedByUserId` are parameters and never fields on `input`,
 * so there is nothing a request body or a model response could fill. The caller
 * passes the session's values; `NewItem` has no slot for them.
 *
 * The category check and the insert are two statements. Wrap the call in a
 * transaction if you need them atomic — a category deleted in between would
 * otherwise fail on the foreign key, which is the correct outcome either way.
 */
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
  attributes?: Record<string, unknown> | null;
  isPrivate?: boolean;
}

/**
 * What an update did, or why it did nothing.
 *
 * `not_the_author` is its own outcome rather than a `null`, because unlike the
 * others it describes a row the caller **can** see: they are entitled to a real
 * refusal (403) rather than a 404 that would be a lie.
 */
export type ItemUpdate =
  | { status: "ok"; item: ItemWithAuthor }
  | { status: "not_found" }
  | { status: "unknown_category" }
  | { status: "not_the_author" };

/**
 * Updates an item.
 *
 * Any member may edit any item they can see: the item is the household's, and
 * `added_by_user_id` records who added it rather than conferring a claim on it.
 *
 * **`isPrivate` is the single exception.** Only the member in
 * `added_by_user_id` may set or clear it, because privacy is *defined* against
 * that column — another member marking the row private would hide it from the
 * person who added it and from themselves at the same time, leaving a row nobody
 * in the household can see.
 *
 * `lastUpdated` is deliberately not touched. It tracks when the stock last
 * moved, which is `applyStockChange`'s business; a rename is not a restock.
 */
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

  // An empty patch is a no-op rather than a crash: Drizzle rejects a `SET` with
  // no assignments. The route already 422s on it, so this is for the second
  // caller — the interpreter — which builds its patch from a model response.
  if (Object.keys(patch).length === 0) return { status: "ok", item: existing };

  await db
    .update(inventoryItems)
    .set(patch)
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.householdId, householdId)));

  // Re-read through the visibility scope: a member who has just marked their own
  // item private must still get it back, and one who cleared the flag must see
  // the row as everyone else now will.
  return { status: "ok", item: (await getItem(db, householdId, actorId, id))! };
}

/**
 * Deletes an item, returning whether there was one to delete.
 *
 * Scoped by household and visibility in the statement itself, so a foreign or
 * invisible id deletes nothing and reports `false` rather than reaching a row it
 * should not have.
 *
 * A `mandates` row referencing this item does not cascade from here — that FK's
 * behaviour belongs to the mandates module, and it will surface as a constraint
 * error the caller turns into a 409.
 */
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

/**
 * A stock movement: an absolute count, or a relative change.
 *
 * Two shapes rather than one nullable pair, because "set it to 2" and "add 2"
 * are different operations that happen to write the same column.
 */
export type StockChange = { quantity: number } | { delta: number };

export type StockResult =
  | { status: "ok"; item: ItemWithAuthor }
  | { status: "not_found" }
  | { status: "unknown_quantity" };

/**
 * How many items sit in each category, as this member sees them.
 *
 * Lives here rather than in `categories.ts` because it is a query over
 * `inventory_items` that must respect the visibility filter — and because that
 * keeps the repository imports pointing the same way the schema's do. The
 * categories page joins these onto `listCategories`; a category with no visible
 * items is simply absent from the map and reads as 0.
 *
 * Two members of one household can legitimately read different numbers off the
 * same category. That is the consequence PRD §2.5.9 states outright: a
 * household-wide figure would announce that private items exist and how many.
 */
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

/**
 * How many items block one category's deletion, and how many of those the asking
 * member can see.
 *
 * The two differ when another member holds private items in the category, and
 * only `visible` may ever be shown: a number that included rows the caller
 * cannot see would report the existence of somebody else's private items, which
 * is the one thing private is for preventing. Where the two disagree, say the
 * category is still in use and give no number.
 *
 * `total` is here because it is the only way to know they disagree.
 */
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

/**
 * Applies a stock change and stamps `lastUpdated` — the one path that moves it.
 *
 * A **delta is applied in SQL** (`quantity = quantity + n`), not read into JS and
 * written back: two members adjusting the same item at once would otherwise each
 * write a number computed from the value before the other's change, and one
 * adjustment would vanish with nothing erroring.
 *
 * `delta` against a **null** quantity is refused rather than resolved. Null means
 * "tracked, count unknown" (§2.5.1), and it is a genuinely different thing from
 * zero: treating it as 0 would invent a count the household never recorded, and
 * "two more than unknown" has no answer. Setting an absolute `quantity` is how a
 * caller leaves that state, and the refusal says so.
 *
 * A delta that would take stock below zero clamps at zero: `quantity` is a
 * count of things on a shelf, and "used three of the two we had" is a miscount,
 * not a negative pantry.
 */
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
