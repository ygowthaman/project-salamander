import { db } from "../db/client.js";
import { User } from "../db/schema/auth.js";
import type { Category } from "../db/schema/index.js";
import * as categoriesRepo from "../db/repositories/categories.js";
import { countItemsInCategory } from "../db/repositories/inventoryItems.js";

export class CategoryError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "CategoryError";
  }
}

function duplicateName(name: string): CategoryError {
  return new CategoryError(409, `A category called "${name}" already exists`);
}

function notFound(): CategoryError {
  return new CategoryError(404, "That category no longer exists");
}

export async function listCategories(actor: User): Promise<Category[]> {
  return categoriesRepo.listCategories(db, actor.householdId);
}

export async function getCategory(actor: User, id: string): Promise<Category> {
  const category = await categoriesRepo.getCategory(db, actor.householdId, id);
  if (!category) throw notFound();
  return category;
}

export async function findCategoriesByName(actor: User, name: string): Promise<Category[]> {
  return categoriesRepo.findCategoriesByName(db, actor.householdId, name);
}

export async function createCategory(actor: User, name: string): Promise<Category> {
  const result = await categoriesRepo.createCategory(db, actor.householdId, name);
  if (result.status === "duplicate_name") throw duplicateName(name);
  return result.category;
}

export async function renameCategory(actor: User, id: string, name: string): Promise<Category> {
  const result = await categoriesRepo.renameCategory(db, actor.householdId, id, name);
  if (!result) throw notFound();
  if (result.status === "duplicate_name") throw duplicateName(name);
  return result.category;
}

export async function deleteCategory(actor: User, id: string): Promise<void> {
  const outcome = await categoriesRepo.deleteCategory(db, actor.householdId, id);
  if (outcome === "not_found") throw notFound();
  if (outcome === "in_use") {
    const { total } = await countItemsInCategory(db, actor.householdId, actor.id, id);
    throw new CategoryError(
      409,
      `${total} ${total === 1 ? "item is" : "items are"} still in this category. Move or delete them first.`,
    );
  }
}