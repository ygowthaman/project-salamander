import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { inventoryItem } from "../domain/inventory.js";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";

const client = new Anthropic();

const model = "claude-sonnet-5";

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

const itemSelector = {
  q: inventoryItem.shape.name,
  category_id: inventoryItem.shape.category_id.nullable()
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

const interpretationFormat = {
  type: "json_schema" as const,
  schema: transformJSONSchema(z.toJSONSchema(interpretation, { reused: "inline" }))
}

function instructions(categories: Category[]) {
  return `You interpret one sentence from an inventory app.
  Categories for this sentence:
  ${categories.map((c) => `${c.id} ${c.name}`).join("\n")}
  Use create_item when the sentence adds something to the inventory.
  Use update_item when it changes something already in the inventory, and put only
  the fields that change in changes, leaving every other field null.
  Use delete_item when it removes something from the inventory entirely.
  Use find_items when it asks what the items are available.
  Use question when the sentence is ambiguous, or names nothing in the category list,
  or your are otherwise not able to resolve it to create_item or find_item.
  category_id must be one of the ids in the categories list.
  For update_item and delete_item, q is the words the sentence used for the item.
  You do not know which items exist, so never invent one that was not named.
  `;
}

export async function interpret(
  sentence: string,
  categories: Category[]
): Promise<Interpretation | null> {
  const response = await client.messages.parse({
    model,
    max_tokens: 512,
    thinking: { type: "disabled" },
    system: instructions(categories),
    output_config: { format: interpretationFormat },
    messages: [{ role: "user", content: sentence }]
  });

  const block = response.content.find(b => b.type === "text");
  if (!block) return null;

  try {
    const parsed = interpretation.safeParse(JSON.parse(block.text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}