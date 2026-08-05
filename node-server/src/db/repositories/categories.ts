import { and, asc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { categories, type Category } from "../schema/index.js";

/**
 * The household's own taxonomy (PRD §2.5.2).
 *
 * Every function takes `householdId` and scopes on it in the query itself, so a
 * category id from another household is indistinguishable from one that does
 * not exist — the caller gets `null` and answers 404, never 403.
 *
 * **This module touches only the `categories` table**, which is what keeps the
 * repository layer's dependencies pointing the same way the schema's do
 * (`categories ← inventory`). Item counts per category are a query over
 * `inventory_items` and live in `inventoryItems.ts` with the visibility filter
 * they have to respect; they are joined to these rows a layer up.
 *
 * Nothing here takes an `actorId`. A category is a shared label, not something a
 * member can hold privately — privacy is a property of an item.
 */

/** Postgres error codes this module turns into ordinary outcomes. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Ordered case-insensitively, so "books" and "Books" would sit together rather
 * than in separate halves of the list — which is how the household reads them,
 * and the same comparison the unique index uses.
 */
export async function listCategories(
  db: DbExecutor,
  householdId: string,
): Promise<Category[]> {
  return db
    .select()
    .from(categories)
    .where(eq(categories.householdId, householdId))
    .orderBy(asc(sql`lower(${categories.name})`));
}

export async function getCategory(
  db: DbExecutor,
  householdId: string,
  id: string,
): Promise<Category | null> {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

/**
 * Whether a category id is one this household may use.
 *
 * Its own function because the item writes need exactly this and do not need the
 * row — a foreign `category_id` in a request body has to fail the same way as a
 * nonexistent one, and this is the single check that decides it.
 */
export async function categoryExists(
  db: DbExecutor,
  householdId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
    .limit(1);
  return row !== undefined;
}

/**
 * `duplicate_name` is the case-insensitive unique index firing, which the caller
 * turns into a 409. Returned rather than thrown because it is an ordinary
 * outcome of a user typing a name that already exists, not an exceptional one.
 */
export type CategoryWrite = { status: "ok"; category: Category } | { status: "duplicate_name" };

/**
 * The name is stored exactly as typed. Uniqueness is enforced by a `lower(name)`
 * expression index rather than by normalising on write, because the casing the
 * user chose is worth keeping — "Books", not "books" — so nothing here
 * lowercases on the way in.
 */
export async function createCategory(
  db: DbExecutor,
  householdId: string,
  name: string,
): Promise<CategoryWrite> {
  try {
    const [row] = await db.insert(categories).values({ householdId, name }).returning();
    return { status: "ok", category: row! };
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) return { status: "duplicate_name" };
    throw error;
  }
}

/**
 * Renaming is safe by construction: items reference the category by id, so every
 * item follows the rename and no history is rewritten (PRD §2.5.2).
 *
 * `null` is "no such category here" — the same answer a foreign id gets.
 */
export async function renameCategory(
  db: DbExecutor,
  householdId: string,
  id: string,
  name: string,
): Promise<CategoryWrite | null> {
  try {
    const [row] = await db
      .update(categories)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
      .returning();
    return row ? { status: "ok", category: row } : null;
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) return { status: "duplicate_name" };
    throw error;
  }
}

export type CategoryDeletion = "deleted" | "not_found" | "in_use";

/**
 * Deleting a category that still has items is refused, not cascaded (§2.5.2):
 * `inventory_items.category_id` is `ON DELETE RESTRICT` precisely so a mistyped
 * delete cannot take a whole collection with it.
 *
 * **The constraint is what decides it, not a count taken first.** Counting and
 * then deleting leaves a window in which an item is added in between, and the
 * delete would then fail as a driver error rather than as this function's
 * `in_use`. Letting the FK raise closes that window, at the cost of one caught
 * error on a path a user hits rarely.
 *
 * The count to *show* alongside a refusal is a separate question with a
 * different answer — see `countItemsInCategory` in `inventoryItems.ts`, which
 * only ever reports items the asking member can see.
 */
export async function deleteCategory(
  db: DbExecutor,
  householdId: string,
  id: string,
): Promise<CategoryDeletion> {
  try {
    const deleted = await db
      .delete(categories)
      .where(and(eq(categories.id, id), eq(categories.householdId, householdId)))
      .returning({ id: categories.id });
    return deleted.length > 0 ? "deleted" : "not_found";
  } catch (error) {
    if (pgErrorCode(error) === FOREIGN_KEY_VIOLATION) return "in_use";
    throw error;
  }
}
