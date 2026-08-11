import { interpret, Interpretation } from "../agents/inventory.js";
import { ItemWithAuthor } from "../db/repositories/inventoryItems.js";
import { User } from "../db/schema/auth.js";
import * as categoriesRepo from "../db/repositories/categories.js";
import * as itemsRepo from "../db/repositories/inventoryItems.js";
import { db } from "../db/client.js";

type ProposedItem = Extract<Interpretation, { type: "create_item" }>["item"];

export type Interpreted =
  | { type: "question"; question: string }
  | { type: "items"; items: ItemWithAuthor[]; total: number }
  | { type: "proposal"; item: ProposedItem }

export async function interpretSentence(actor: User, text: string): Promise<Interpreted | null> {
  const categories = await categoriesRepo.listCategories(db, actor.householdId);
  const result = await interpret(text, categories.map(c => ({ id: c.id, name: c.name })));

  if (!result) return null;

  switch (result.type) {
    case "question":
      return {
        type: "question",
        question: result.question
      };
    case "create_item":
      return {
        type: "proposal",
        item: result.item
      }
    case "find_items":
      const { items, total } = await itemsRepo.listItems(db, actor.householdId, actor.id, {
        q: result.q ?? undefined,
        categoryId: result.category_id ?? undefined,
        limit: 50,
        offset: 0
      });
      return { type: "items", items, total };
    default: {
      const unhandled: never = result;
      throw new Error(`Unhandled interpretation: ${JSON.stringify(unhandled)}`);
    }
  }
}