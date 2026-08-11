import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import type { ItemWithAuthor } from "../db/repositories/inventoryItems.js";
import { inventoryItem } from "../domain/inventory.js";
import { interpretSentence } from "../services/inventory.js";

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
  app.get("/inventory/items/grouped", async (request, reply) => {
    void request.user;
    return notImplemented(reply, "GET /inventory/items/grouped");
  });

  app.get("/inventory/items/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    void request.user;
    return notImplemented(reply, "GET /inventory/items/:id");
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
        return response.send({ type: "create_proposal", item: result.item });
      case "update_proposal":
        return response.send({
          type: "update_proposal",
          item: serialiseItem(result.item),
          changes: result.changes
        });
      case "delete_proposal":
        return response.send({ type: "delete_proposal", item: serialiseItem(result.item) });
      case "no_match":
        return response.send({
          type: "question",
          question: `Nothing in your inventory matches "${result.q}".`
        });
      case "ambiguous":
        return response.send({
          type: "question",
          question: `"${result.q}" matches more than one item. Which one did you mean?`,
          items: result.items.map(serialiseItem)
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
    void request.user;
    return notImplemented(reply, "POST /inventory/item");
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
    void request.user;
    return notImplemented(reply, "PATCH /inventory/items/:id");
  });

  app.delete("/inventory/items/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    void request.user;
    return notImplemented(reply, "DELETE /inventory/items/:id");
  });
};
