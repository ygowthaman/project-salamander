import { interpretInventory, Interpretation } from "../agents/inventory.js";
import { ItemPatch, ItemWithAuthor, NewItem } from "../db/repositories/inventoryItems.js";
import { User } from "../db/schema/auth.js";
import * as categoriesRepo from "../db/repositories/categories.js";
import * as itemsRepo from "../db/repositories/inventoryItems.js";
import { db } from "../db/client.js";

export class InventoryError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "InventoryError";
  }
}

function unknownCategory(): InventoryError {
  return new InventoryError(404, "That category no longer exists");
}

function itemNotFound(): InventoryError {
  return new InventoryError(404, "That item no longer exists");
}

type ProposedItem = Extract<Interpretation, { type: "create_item" }>["item"];
type ProposedChanges = Extract<Interpretation, { type: "update_item" }>["changes"];

export type Changes = { [K in keyof ProposedChanges]?: NonNullable<ProposedChanges[K]> };

export type Interpreted =
  | { type: "question"; question: string }
  | { type: "items"; items: ItemWithAuthor[]; total: number }
  | { type: "create_proposal"; item: ProposedItem }
  | { type: "update_proposal"; item: ItemWithAuthor; changes: Changes }
  | { type: "delete_proposal"; item: ItemWithAuthor }
  | { type: "no_match"; q: string }
  | { type: "ambiguous"; q: string; items: ItemWithAuthor[] }

export type CategoryGroup = {
  category: { id: string; name: string };
  items: ItemWithAuthor[];
};

export async function listItemsByCategory(actor: User): Promise<CategoryGroup[]> {
  const rows = await itemsRepo.listItemsWithCategory(db, actor.householdId, actor.id);
  const groups = new Map<string, CategoryGroup>();

  for (const { category, ...item } of rows) {
    const group = groups.get(category.id);
    if (group) group.items.push(item);
    else groups.set(category.id, { category, items: [item] });
  }

  return [...groups.values()];
}

export async function createItem(actor: User, input: NewItem): Promise<ItemWithAuthor> {
  const item = await itemsRepo.createItem(db, actor.householdId, actor.id, input);
  if (!item) throw unknownCategory();
  return item;
}

export async function getItem(actor: User, id: string): Promise<ItemWithAuthor> {
  const item = await itemsRepo.getItem(db, actor.householdId, actor.id, id);
  if (!item) throw itemNotFound();
  return item;
}

export async function updateItem(
  actor: User,
  id: string,
  patch: ItemPatch,
): Promise<ItemWithAuthor> {
  const result = await itemsRepo.updateItem(db, actor.householdId, actor.id, id, patch);

  switch (result.status) {
    case "ok":
      return result.item;
    case "not_found":
      throw itemNotFound();
    case "unknown_category":
      throw unknownCategory();
    case "not_the_author":
      throw new InventoryError(
        403,
        "Only the member who added an item can change whether it is private",
      );
  }
}

export async function deleteItem(actor: User, id: string): Promise<void> {
  const deleted = await itemsRepo.deleteItem(db, actor.householdId, actor.id, id);
  if (!deleted) throw itemNotFound();
}

const candidateLimit = 5;

type Resolution =
  | { status: "one"; item: ItemWithAuthor }
  | { status: "none" }
  | { status: "many"; items: ItemWithAuthor[] }

async function resolveNamedItem(
  actor: User,
  q: string,
  categoryId: string | null
): Promise<Resolution> {
  const { items, total } = await itemsRepo.listItems(db, actor.householdId, actor.id, {
    q,
    categoryId: categoryId ?? undefined,
    limit: candidateLimit,
    offset: 0
  });

  const [only] = items;
  if (!only) return { status: "none" };
  if (total > 1) return { status: "many", items };
  return { status: "one", item: only };
}

function withoutUnchanged(changes: ProposedChanges): Changes {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== null)
  ) as Changes;
}

export async function interpretSentence(actor: User, text: string): Promise<Interpreted | null> {
  const categories = await categoriesRepo.listCategories(db, actor.householdId);
  const result = await interpretInventory(text, categories.map(c => ({ id: c.id, name: c.name })));

  if (!result) return null;

  switch (result.type) {
    case "question":
      return {
        type: "question",
        question: result.question
      };
    case "create_item":
      return {
        type: "create_proposal",
        item: result.item
      }
    case "update_item": {
      const changes = withoutUnchanged(result.changes);
      if (Object.keys(changes).length === 0) return null;

      const resolved = await resolveNamedItem(actor, result.q, result.category_id);
      if (resolved.status === "none") return { type: "no_match", q: result.q };
      if (resolved.status === "many") {
        return { type: "ambiguous", q: result.q, items: resolved.items };
      }
      return { type: "update_proposal", item: resolved.item, changes };
    }
    case "delete_item": {
      const resolved = await resolveNamedItem(actor, result.q, result.category_id);
      if (resolved.status === "none") return { type: "no_match", q: result.q };
      if (resolved.status === "many") {
        return { type: "ambiguous", q: result.q, items: resolved.items };
      }
      return { type: "delete_proposal", item: resolved.item };
    }
    case "find_items": {
      const { items, total } = await itemsRepo.listItems(db, actor.householdId, actor.id, {
        q: result.q ?? undefined,
        categoryId: result.category_id ?? undefined,
        limit: 50,
        offset: 0
      });
      return { type: "items", items, total };
    }
    default: {
      const unhandled: never = result;
      throw new Error(`Unhandled interpretation: ${JSON.stringify(unhandled)}`);
    }
  }
}
