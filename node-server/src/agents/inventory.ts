import { z } from "zod";
import { inventoryItem } from "../domain/inventory.js";
import { interpretAs } from "./client.js";

const proposedItem = inventoryItem.extend({
  unit: inventoryItem.shape.unit.nullable(),
  attributes: inventoryItem.shape.attributes.nullable(),
  quantity: inventoryItem.shape.quantity.min(1),
}).strict();

const proposedChanges = z.object({
  name: inventoryItem.shape.name.nullable(),
  category_id: inventoryItem.shape.category_id.nullable(),
  unit: inventoryItem.shape.unit.nullable(),
  quantity: inventoryItem.shape.quantity.nullable(),
  attributes: inventoryItem.shape.attributes.nullable(),
  is_private: inventoryItem.shape.is_private.nullable()
}).strict();

const itemSelector = z.object({
  q: inventoryItem.shape.name,
  category_id: inventoryItem.shape.category_id.nullable()
}).strict();

const proposedUpdate = itemSelector.extend({ changes: proposedChanges }).strict();

export const interpretation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_item"),
    items: z.array(proposedItem).min(1)
  }).strict(),
  z.object({
    type: z.literal("update_item"),
    updates: z.array(proposedUpdate).min(1)
  }).strict(),
  z.object({
    type: z.literal("delete_item"),
    targets: z.array(itemSelector).min(1)
  }).strict(),
  z.object({
    type: z.literal("find_items"),
    q: inventoryItem.shape.name.nullable(),
    category_id: inventoryItem.shape.category_id.nullable()
  }).strict(),
  z.object({
    type: z.literal("question"),
    question: z.string().trim().min(1).max(200)
  }).strict()
])

export type Interpretation = z.infer<typeof interpretation>;

export type Category = { id: string; name: string };

function instructions(categories: Category[]) {
  return `You interpret one sentence from an inventory app.
  Categories for this sentence:
  ${categories.map((c) => `${c.id} ${c.name}`).join("\n")}
  One sentence may name several things, and they all belong to one operation:
  "add 1984 and Origin to books" is one create_item with two entries in items, and
  "we need eggs, milk, bread" is one update_item with three entries in updates.
  Use create_item when the sentence adds things to the inventory, one entry in items
  per thing added.
  Use update_item when it changes things already in the inventory, one entry in
  updates per thing changed, and put only the fields that change in changes, leaving
  every other field null.
  Use delete_item when it removes things from the inventory entirely, one entry in
  targets per thing removed.
  Use find_items when it asks what the items are available.
  Use question when the sentence is ambiguous, or names nothing in the category list,
  or you are otherwise not able to resolve it to one of the other operations.
  category_id must be one of the ids in the categories list.
  For update_item and delete_item, q is the words the sentence used for the item.
  You do not know which items exist, so never invent one that was not named.
  name is what the thing is, as someone would write it on a list.
  attributes is whatever narrows it to one particular version of that thing.
  "2 litres of 2% milk" is name milk, attributes 2%.
  "add 1984 unabridged version to books" is name 1984, attributes unabridged version.
  Use the words the sentence used, and leave attributes null when nothing narrows it.
  `;
}

export async function interpretInventory(
  sentence: string,
  categories: Category[]
): Promise<Interpretation | null> {
  return interpretAs(sentence, instructions(categories), interpretation);
}
