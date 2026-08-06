import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import type { ItemWithAuthor } from "../db/repositories/inventoryItems.js";
import { request } from "node:http";

const idParams = z.object({
  id: z.string().uuid(),
});

const createItemBody = z.object({
  name: z.string().trim().min(1).max(200),
  category_id: z.string().uuid(),
  unit: z.string().trim().min(1).max(50).nullish(),
  quantity: z.number().int().min(0).nullish(),
  attributes: z.string().trim().min(1).max(500).nullish(),
  is_private: z.boolean().default(false),
});

const updateItemBody = createItemBody.partial().refine((b) => Object.keys(b).length > 0, {
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

  app.post("inventory/interpret", async (request, response) => {
    const parsed = interpretBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return response.code(422).send({ detail: parsed.error.issues });
    }
    void request.user;
    void interpretationFailed;
    return notImplemented(response, "POST inventory/interpret")
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
