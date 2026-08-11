import { z } from "zod";
import { interpretAs } from "./client.js";

const categoryItem = z.object({
  name: z.string().trim().min(1).max(200)
});

const proposedItem = categoryItem.strict();

const proposedChanges = categoryItem.strict();

const itemSelector = {
  name: categoryItem.shape.name
};

export const interpretation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_item"),
    item: proposedItem
  }).strict(),
  z.object({
    type: z.literal("update_item"),
    ...itemSelector,
    changes: proposedChanges
  }).strict(),
  z.object({
    type: z.literal("delete_item"),
    ...itemSelector
  }).strict(),
  z.object({
    type: z.literal("find_items"),
    name: categoryItem.shape.name.nullable(),
  }).strict(),
  z.object({
    type: z.literal("question"),
    question: z.string().trim().min(1).max(200)
  }).strict()
])

export type Interpretation = z.infer<typeof interpretation>;

function instructions() {
  return `You interpret one sentence from an inventory app.
  Use create_item when the sentence adds a new category.
  Use update_item when it changes the name of a category.
  Use delete_item when it removes a category.
  Use find_items when it asks to find a category.
  Use question when the sentence is ambiguous, or names nothing in the category list.
  For update_item and delete_item, q is the words the sentence used for the item.
  You do not know which categories exist, so never invent one that was not named.
  name is what the thing is, as someone would write it on a list.
  `;
}

export async function interpretCategory(
  sentence: string,
): Promise<Interpretation | null> {
  return interpretAs(sentence, instructions(), interpretation);
}
