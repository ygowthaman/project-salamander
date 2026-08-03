import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import type { InventoryEvent, InventoryItem } from "../db/schema/index.js";

// The REST surface for the inventory module. HTTP concerns only: parse, validate,
// bind the caller, shape the response. Every handler stops at `todo()` — the
// service layer that owns the reads, writes and the item+event transaction is
// deliberately not written yet, so the seam is marked rather than guessed at.
//
// Two rules this file already enforces, because they are boundary concerns and
// not service concerns:
//
//   - `user_id` comes from `request.user`, never from the body. The body schemas
//     below have no user_id field at all, so a caller cannot even send one.
//   - Every request body and query string goes through zod here. The interpreter
//     will later reuse these exact schemas to validate what the model returns,
//     which is what keeps a bad parse out of the database (CLAUDE.md).

// ---- Schemas ---------------------------------------------------------------

const idParams = z.object({
  id: z.string().uuid(),
});

// Free-form per item type (author/edition/isbn, model number). Only the envelope
// is constrained — the shape inside is open by design, so it stays a record.
const attributes = z.record(z.unknown());

const createItemBody = z.object({
  name: z.string().trim().min(1).max(200),
  // An id the caller resolved from their own categories, never a free-typed
  // name: budgets aggregate by category, so a string here would split them.
  category_id: z.string().uuid(),
  unit: z.string().trim().min(1).max(50).nullish(),
  // Null is a real state ("tracked, count unknown"), so nullish rather than a
  // default of 0 — those two mean different things and the column allows both.
  quantity: z.number().int().min(0).nullish(),
  attributes: attributes.nullish(),
});

// Every field optional, but at least one present: an empty PATCH is a caller bug
// worth a 422 rather than a no-op 200. `.nullish()` throughout keeps "clear this
// field" (explicit null) distinct from "leave it alone" (absent key).
const updateItemBody = createItemBody.partial().refine((b) => Object.keys(b).length > 0, {
  message: "At least one field must be provided",
});

const listItemsQuery = z.object({
  // Name substring match, for the item picker.
  q: z.string().trim().min(1).max(200).optional(),
  category_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// A stock change is either absolute (`quantity`) or relative (`delta`), never
// both and never neither. Kept as one endpoint because both produce the same
// audit row, and the caller should not have to pick a URL based on phrasing.
const stockBody = z
  .object({
    quantity: z.number().int().min(0).optional(),
    delta: z.number().int().optional(),
    // For an interpreted write this is the user's original phrase ("low on
    // eggs") — provenance for the number, not data anything reads back.
    reason: z.string().trim().min(1).max(500).nullish(),
  })
  .refine((b) => (b.quantity === undefined) !== (b.delta === undefined), {
    message: "Provide exactly one of `quantity` or `delta`",
  });

// The dimensions an item can be grouped along. Both are columns the row already
// carries, which is the bar for entry: a dimension that needs a join the item
// does not have is a different endpoint, not another enum member. Adding one is
// this list plus a matching arm of `groups[].<dimension>` in the response.
const GROUP_BY = ["category", "unit"] as const;

const groupedQuery = z.object({
  group_by: z.enum(GROUP_BY),
  // Required, not derived from the session: a user can belong to more than one
  // household, so "which one" is the caller's to state. The service still has to
  // verify this user is a member — a uuid in a query string proves nothing.
  household_id: z.string().uuid(),
});

const listEventsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ---- Serialisation ---------------------------------------------------------

/** Row → wire shape. snake_case and ISO timestamps, matching the auth routes. */
function publicItem(item: InventoryItem) {
  return {
    id: item.id,
    name: item.name,
    category_id: item.categoryId,
    unit: item.unit,
    quantity: item.quantity,
    attributes: item.attributes,
    created_at: item.createdAt.toISOString(),
    last_updated: item.lastUpdated.toISOString(),
  };
}

type PublicItem = ReturnType<typeof publicItem>;

/**
 * The grouped response, discriminated on `group_by`: the descriptor is keyed by
 * the dimension name rather than a generic `key`, so a client that asked for
 * categories never has to narrow past a shape it cannot receive.
 *
 * `unit` groups carry `{ name: string | null }` because the column is nullable —
 * "no unit" is a real group (every book lands in it), not an omission. Category
 * cannot produce a null group: `category_id` is NOT NULL.
 */
export type ItemGroup =
  | { category: { id: string; name: string }; items: PublicItem[] }
  | { unit: { name: string | null }; items: PublicItem[] };

export type GroupedItemsResponse = {
  group_by: (typeof GROUP_BY)[number];
  groups: ItemGroup[];
};

function publicEvent(event: InventoryEvent) {
  return {
    id: event.id,
    inventory_item_id: event.inventoryItemId,
    delta: event.delta,
    new_stock: event.newStock,
    reason: event.reason,
    created_at: event.createdAt.toISOString(),
  };
}

// ---- Routes ----------------------------------------------------------------

/**
 * Placeholder for the not-yet-written service call. Returns 501 rather than
 * fabricated rows so nothing downstream can mistake a stub for working storage.
 */
function todo(reply: FastifyReply, operation: string) {
  return reply.code(501).send({ detail: `Not implemented: ${operation}` });
}

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  // Inventory is per-user in its entirety; there is no anonymous read.
  app.addHook("preHandler", requireAuth);

  app.get("/inventory/items", async (request, reply) => {
    const parsed = listItemsQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const userId = request.user!.id;

    // service: listItems(userId, parsed.data) -> { items, total }
    void userId;
    void publicItem;
    return todo(reply, "GET /inventory/items");
  });

  // Static segment, so it is matched ahead of `/inventory/items/:id` — "grouped"
  // is never read as an id.
  app.get("/inventory/items/grouped", async (request, reply) => {
    const parsed = groupedQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const userId = request.user!.id;
    const { group_by, household_id } = parsed.data;

    // service: listItemsGrouped(userId, household_id, group_by)
    //   -> GroupedItemsResponse
    //
    //   - Membership first: 404 when this user is not in the household, for the
    //     same reason a foreign category 404s — a 403 confirms it exists.
    //   - The scope is the household, NOT the user. Every other route here
    //     filters on user_id; this one must not, or two members of a household
    //     see different inventories. Once the column lands, revisit whether the
    //     rest of this file should scope by household too — they should not
    //     stay split.
    //   - Grouping belongs in SQL (one ordered query, grouped in a pass over the
    //     rows), not in N+1 queries per group.
    //   - An empty group is not returned: groups come from the items, so a
    //     category with nothing in it has no group. If the UI wants to render
    //     empty categories it should read them from GET /categories.
    void userId;
    void group_by;
    void household_id;
    return todo(reply, "GET /inventory/items/grouped");
  });

  app.post("/inventory/items", async (request, reply) => {
    const parsed = createItemBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const userId = request.user!.id;

    // service: createItem(userId, parsed.data) -> InventoryItem
    //   - 404 when category_id is not one of this user's categories. Not 403:
    //     another user's category id must be indistinguishable from a
    //     nonexistent one, or the response confirms it exists.
    //   - 201 + Location, then push the row on this user's socket.
    void userId;
    return todo(reply, "POST /inventory/items");
  });

  app.get("/inventory/items/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const userId = request.user!.id;

    // service: getItem(userId, parsed.data.id) -> InventoryItem | null
    // Scope the lookup by userId in the query itself, so a foreign id 404s
    // without a second ownership branch anyone can forget to write.
    void userId;
    return todo(reply, "GET /inventory/items/:id");
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
    const userId = request.user!.id;

    // service: updateItem(userId, params.data.id, parsed.data) -> InventoryItem | null
    // Quantity moved through here is a correction, not a stock movement: the
    // event trail and last_updated belong to POST /stock. Worth revisiting when
    // the service lands — it is the one place the two paths could diverge.
    void userId;
    return todo(reply, "PATCH /inventory/items/:id");
  });

  app.delete("/inventory/items/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const userId = request.user!.id;

    // service: deleteItem(userId, parsed.data.id) -> boolean
    // Events cascade with the item. A mandate referencing it does not — that
    // FK's behaviour is the mandates module's call, so expect a 409 here later.
    void userId;
    return todo(reply, "DELETE /inventory/items/:id");
  });

  // ---- Stock -------------------------------------------------------------

  app.post("/inventory/items/:id/stock", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ detail: params.error.issues });
    }
    const parsed = stockBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const userId = request.user!.id;

    // service: applyStockChange(userId, params.data.id, parsed.data)
    //   -> { item, event }
    // One transaction: update quantity + last_updated, insert the event row.
    // `delta` against a null quantity has no defined result — that is the case
    // to decide explicitly (422, or treat null as 0) rather than let it fall out
    // of the arithmetic.
    void userId;
    void publicEvent;
    return todo(reply, "POST /inventory/items/:id/stock");
  });

  app.get("/inventory/items/:id/events", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ detail: params.error.issues });
    }
    const parsed = listEventsQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const userId = request.user!.id;

    // service: listEventsForItem(userId, params.data.id, parsed.data)
    //   -> { events, total }
    // Read-only by design: events are written only as part of a stock change,
    // never posted directly, so the audit trail cannot be authored.
    void userId;
    return todo(reply, "GET /inventory/items/:id/events");
  });
};
