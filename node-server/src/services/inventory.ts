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

type ProposedItem = Extract<Interpretation, { type: "create_item" }>["items"][number];
type ProposedUpdate = Extract<Interpretation, { type: "update_item" }>["updates"][number];
type ProposedChanges = ProposedUpdate["changes"];
type ItemSelector = { q: string; category_id: string | null };

export type Changes = { [K in keyof ProposedChanges]?: NonNullable<ProposedChanges[K]> };

export type Unresolved =
  | { reason: "no_match"; q: string }
  | { reason: "ambiguous"; q: string; items: ItemWithAuthor[] }
  | { reason: "no_changes"; q: string }

export type Interpreted =
  | { type: "question"; question: string }
  | { type: "items"; items: ItemWithAuthor[]; total: number }
  | { type: "create_proposal"; items: ProposedItem[] }
  | { type: "update_proposal"; updates: { item: ItemWithAuthor; changes: Changes }[] }
  | { type: "delete_proposal"; items: ItemWithAuthor[] }
  | { type: "unresolved"; failures: Unresolved[] }

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
  | { resolved: true; item: ItemWithAuthor }
  | { resolved: false; failure: Unresolved }

async function resolveSelector(actor: User, selector: ItemSelector): Promise<Resolution> {
  const { q } = selector;
  const { items, total } = await itemsRepo.listItems(db, actor.householdId, actor.id, {
    q,
    categoryId: selector.category_id ?? undefined,
    limit: candidateLimit,
    offset: 0
  });

  const [only] = items;
  if (!only) return { resolved: false, failure: { reason: "no_match", q } };
  if (total > 1) return { resolved: false, failure: { reason: "ambiguous", q, items } };
  return { resolved: true, item: only };
}

async function resolveEvery<T extends ItemSelector>(actor: User, selectors: T[]) {
  const outcomes = await Promise.all(
    selectors.map(async (selector) => ({
      selector,
      resolution: await resolveSelector(actor, selector)
    }))
  );

  return {
    failures: outcomes.flatMap(({ resolution }) =>
      resolution.resolved ? [] : [resolution.failure]
    ),
    resolved: outcomes.flatMap(({ selector, resolution }) =>
      resolution.resolved ? [{ selector, item: resolution.item }] : []
    )
  };
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
        items: result.items
      }
    case "update_item": {
      const requested = result.updates.map((update) => ({
        ...update,
        changes: withoutUnchanged(update.changes)
      }));
      const unchanged = requested
        .filter(({ changes }) => Object.keys(changes).length === 0)
        .map(({ q }): Unresolved => ({ reason: "no_changes", q }));

      const { resolved, failures } = await resolveEvery(actor, requested);
      if (failures.length + unchanged.length > 0) {
        return { type: "unresolved", failures: [...failures, ...unchanged] };
      }

      return {
        type: "update_proposal",
        updates: resolved.map(({ item, selector }) => ({ item, changes: selector.changes }))
      };
    }
    case "delete_item": {
      const { resolved, failures } = await resolveEvery(actor, result.targets);
      if (failures.length > 0) return { type: "unresolved", failures };

      return { type: "delete_proposal", items: resolved.map(({ item }) => item) };
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
