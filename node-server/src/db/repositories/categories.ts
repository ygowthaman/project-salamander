import { and, asc, eq, ilike, sql } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { categories, type Category } from "../schema/index.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

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

export async function findCategoriesByName(
  db: DbExecutor,
  householdId: string,
  name: string,
): Promise<Category[]> {
  const pattern = `%${name.replace(/[\\%_]/g, "\\$&")}%`;
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, householdId), ilike(categories.name, pattern)))
    .orderBy(asc(sql`lower(${categories.name})`));
}

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

export type CategoryWrite = { status: "ok"; category: Category } | { status: "duplicate_name" };

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
