import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import type { ItemWithAuthor } from "../db/repositories/inventoryItems.js";
import { inventoryItem } from "../domain/inventory.js";
import {
  InventoryError,
  Unresolved,
  createItem,
  deleteItem,
  getItem,
  interpretSentence,
  listItemsByCategory,
  updateItem,
} from "../services/inventory.js";

const idParams = z.object({
  id: z.string().uuid(),
});

const itemBody = inventoryItem.extend({
  unit: inventoryItem.shape.unit.nullish(),
  attributes: inventoryItem.shape.attributes.nullish(),
});

const createItemBody = itemBody.extend({
  quantity: itemBody.shape.quantity.min(1),
  is_private: itemBody.shape.is_private.default(false),
});

const updateItemBody = itemBody.partial().refine((b) => Object.keys(b).length > 0, {
  message: "At least one field must be provided",
});

const listItemsQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  category_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const stockBody = z
  .object({
    quantity: z.number().int().min(0).optional(),
    delta: z.number().int().optional(),
  })
  .refine((b) => (b.quantity === undefined) !== (b.delta === undefined), {
    message: "Provide exactly one of `quantity` or `delta`",
  });

const interpretBody = z.object({
  text: z.string().trim().min(1).max(1000),
  exchange_id: z.string().uuid().optional()
});

const interpretationFailed = "This could not be understood. Try using a the form instead";

function serialiseItem(item: ItemWithAuthor) {
  return {
    id: item.id,
    name: item.name,
    category_id: item.categoryId,
    unit: item.unit,
    quantity: item.quantity,
    attributes: item.attributes,
    added_by: { id: item.addedBy.id, name: item.addedBy.name },
    is_private: item.isPrivate,
    created_at: item.createdAt.toISOString(),
    last_updated: item.lastUpdated.toISOString(),
  };
}

type SerialisedItem = ReturnType<typeof serialiseItem>;

function quoted(values: string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}

function unresolvedQuestion(failures: Unresolved[]): string {
  const missing = failures.filter((f) => f.reason === "no_match").map((f) => f.q);
  const crowded = failures.filter((f) => f.reason === "ambiguous").map((f) => f.q);
  const vague = failures.filter((f) => f.reason === "no_changes").map((f) => f.q);
  const sentences: string[] = [];

  if (missing.length > 0) sentences.push(`Nothing in your inventory matches ${quoted(missing)}.`);
  if (crowded.length > 0) sentences.push(`More than one item matches ${quoted(crowded)}.`);
  if (vague.length > 0) sentences.push(`You did not say what to change about ${quoted(vague)}.`);
  sentences.push("Nothing was saved — the whole sentence has to resolve.");

  return sentences.join(" ");
}

function candidatesFrom(failures: Unresolved[]) {
  return failures.flatMap((failure) => (failure.reason === "ambiguous" ? failure.items : []));
}

export type ItemGroup = {
  category: { id: string; name: string };
  items: SerialisedItem[];
};

export type GroupedItemsResponse = {
  groups: ItemGroup[];
};

function notImplemented(reply: FastifyReply, operation: string) {
  return reply.code(501).send({ detail: `Not implemented: ${operation}` });
}

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof InventoryError) {
      return reply.code(error.status).send({ detail: error.detail });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ detail: error.message });
    }
    request.log.error({ err: error }, "inventory route failed");
    return reply.code(500).send({ detail: "Internal server error" });
  });

  app.get("/inventory/items", async (request, reply) => {
    const parsed = listItemsQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    void request.user;
    void serialiseItem;
    return notImplemented(reply, "GET /inventory/items");
  });

  // Declared before `/inventory/items/:id` so "grouped" is not matched as an id.
  app.get("/inventory/items/grouped", async (request): Promise<GroupedItemsResponse> => {
    const groups = await listItemsByCategory(request.user!);
    return {
      groups: groups.map(({ category, items }) => ({
        category,
        items: items.map(serialiseItem),
      })),
    };
  });

  app.get("/inventory/items/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    return serialiseItem(await getItem(request.user!, parsed.data.id));
  });

  app.post("/inventory/interpret", async (request, response) => {
    const parsed = interpretBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return response.code(422).send({ detail: parsed.error.issues });
    }
    const result = await interpretSentence(request.user!, parsed.data.text);
    if (!result) {
      return response.code(422).send({ detail: interpretationFailed });
    }

    switch (result.type) {
      case "question":
        return response.send({ type: "question", question: result.question });
      case "items":
        return response.send({
          type: "items",
          items: result.items.map(serialiseItem),
          total: result.total
        });
      case "create_proposal":
        return response.send({ type: "create_proposal", items: result.items });
      case "update_proposal":
        return response.send({
          type: "update_proposal",
          updates: result.updates.map(({ item, changes }) => ({
            item: serialiseItem(item),
            changes
          }))
        });
      case "delete_proposal":
        return response.send({
          type: "delete_proposal",
          items: result.items.map(serialiseItem)
        });
      case "unresolved":
        return response.send({
          type: "question",
          question: unresolvedQuestion(result.failures),
          items: candidatesFrom(result.failures).map(serialiseItem)
        });
      default: {
        const unhandled: never = result;
        throw new Error(`Unhandled interpretation: ${JSON.stringify(unhandled)}`);
      }
    }
  })

  app.post("/inventory/item", async (request, reply) => {
    const parsed = createItemBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const { category_id, is_private, ...fields } = parsed.data;
    const item = await createItem(request.user!, {
      ...fields,
      categoryId: category_id,
      isPrivate: is_private,
    });
    return reply.code(201).send(serialiseItem(item));
  });

  app.post("/inventory/items/:id/stock", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ detail: params.error.issues });
    }
    const parsed = stockBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    void request.user;
    return notImplemented(reply, "POST /inventory/items/:id/stock");
  });

  app.patch("/inventory/items/:id", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ detail: params.error.issues });
    }
    const parsed = updateItemBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const { category_id, is_private, ...fields } = parsed.data;
    const item = await updateItem(request.user!, params.data.id, {
      ...fields,
      ...(category_id !== undefined && { categoryId: category_id }),
      ...(is_private !== undefined && { isPrivate: is_private }),
    });
    return serialiseItem(item);
  });

  app.delete("/inventory/items/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    await deleteItem(request.user!, parsed.data.id);
    return reply.code(204).send();
  });
};
