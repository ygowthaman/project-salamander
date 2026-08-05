import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
// The read joins `users` and resolves the attribution name once, in SQL — this
// is the shape it hands over, and the serialiser below is the only consumer of
// it that matters to the wire.
import type { ItemWithAuthor } from "../db/repositories/inventoryItems.js";

// The REST surface for the inventory module. HTTP concerns only: parse, validate,
// bind the caller, shape the response. Every handler stops at `todo()` — the
// service layer that owns the reads, writes and the item+event transaction is
// deliberately not written yet, so the seam is marked rather than guessed at.
//
// Two rules this file already enforces, because they are boundary concerns and
// not service concerns:
//
//   - `household_id` and `added_by_user_id` come from `request.user`, never from
//     a body or a query string (PRD §2.5.9). A user belongs to exactly one
//     household (§2.2.2), so there is nothing for a caller to choose: the
//     schemas below carry neither field, and a caller cannot even send one.
//
// And one rule the whole file is shaped around: **`household_id` is the scope,
// the actor is not.** The inventory belongs to the household (PRD §2.5), so
// every service contract below takes `(householdId, actorId, …)` where
// `householdId` is what the query filters on and `actorId` feeds exactly one
// thing — the visibility filter `NOT is_private OR added_by_user_id = actorId`
// (§2.5.9). A contract that narrows rows by the actor for any other reason is
// wrong: two members of one household would see different inventories.
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
  // An item is the household's to see unless the member who adds it says
  // otherwise (PRD §2.5.9), so the default is `false` and privacy is an explicit
  // act. Not `.nullish()`: there is no "clear this field" state — the column is
  // NOT NULL and the two values are the whole domain.
  is_private: z.boolean().default(false),
});

// Every field optional, but at least one present: an empty PATCH is a caller bug
// worth a 422 rather than a no-op 200. `.nullish()` throughout keeps "clear this
// field" (explicit null) distinct from "leave it alone" (absent key).
//
// `is_private` comes along, so a member can mark an item private later or unmark
// it. Only the member in `added_by_user_id` may do so: privacy is defined
// against that column, so letting anyone else set it would produce a row its own
// author cannot see and the setter cannot see either. That check is the
// service's — the schema's job is only to let the field through.
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
// both and never neither. Kept as one endpoint because both land on the same
// column, and the caller should not have to pick a URL based on phrasing.
const stockBody = z
  .object({
    quantity: z.number().int().min(0).optional(),
    delta: z.number().int().optional(),
  })
  .refine((b) => (b.quantity === undefined) !== (b.delta === undefined), {
    message: "Provide exactly one of `quantity` or `delta`",
  });

// ---- Serialisation ---------------------------------------------------------

/**
 * Row → wire shape. snake_case and ISO timestamps, matching the auth routes.
 *
 * `household_id` is deliberately absent. Every response is already scoped to the
 * caller's household, so the column would be the same value on every row of
 * every response — and a member at `skip_household = true` does not know they
 * are in one, so it is a concept the wire should not volunteer either.
 */
function serialiseItem(item: ItemWithAuthor) {
  return {
    id: item.id,
    name: item.name,
    category_id: item.categoryId,
    unit: item.unit,
    quantity: item.quantity,
    attributes: item.attributes,
    // Who added it (PRD §2.5.9). Always present: the column is NOT NULL, and a
    // retired member's row survives precisely so this still renders a name.
    added_by: { id: item.addedBy.id, name: item.addedBy.name },
    // Only ever `true` on the caller's own items — a private row belonging to
    // anyone else was filtered out before serialisation, so the client can read
    // this as "private, and mine" without a second comparison.
    is_private: item.isPrivate,
    created_at: item.createdAt.toISOString(),
    last_updated: item.lastUpdated.toISOString(),
  };
}

type SerialisedItem = ReturnType<typeof serialiseItem>;

/**
 * One category and everything in it.
 *
 * The descriptor is keyed `category` rather than a generic `key`, so the shape
 * says what it is grouped by and a client never has to read a separate field to
 * find out. A category group can never be null-keyed: `category_id` is NOT NULL.
 */
export type ItemGroup = {
  category: { id: string; name: string };
  items: SerialisedItem[];
};

export type GroupedItemsResponse = {
  groups: ItemGroup[];
};

// ---- Routes ----------------------------------------------------------------

/**
 * Placeholder for the not-yet-written service call. Returns 501 rather than
 * fabricated rows so nothing downstream can mistake a stub for working storage.
 */
function todo(reply: FastifyReply, operation: string) {
  return reply.code(501).send({ detail: `Not implemented: ${operation}` });
}

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  // Inventory is household-scoped in its entirety, and membership is the only
  // way in (PRD §2.5) — so there is no anonymous read.
  app.addHook("preHandler", requireAuth);

  app.get("/inventory/items", async (request, reply) => {
    const parsed = listItemsQuery.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const householdId = request.user!.householdId;
    const actorId = request.user!.id;

    // service: listItems(householdId, actorId, parsed.data) -> { items, total }
    //   - `total` is counted over the same filtered set, not over the household:
    //     PRD §2.5.9 says counts differ between members and that is correct.
    void householdId;
    void actorId;
    void serialiseItem;
    return todo(reply, "GET /inventory/items");
  });

  // Static segment, so it is matched ahead of `/inventory/items/:id` — "grouped"
  // is never read as an id.
  //
  // Category is the only grouping there is, so it is in the path rather than a
  // query parameter: an item's category is a record the household curates, and
  // PRD §2.5.1 keeps `unit` free text precisely because nothing groups or totals
  // by it. A dimension that is not a table of its own does not get an endpoint.
  app.get("/inventory/items/grouped", async (request, reply) => {
    const householdId = request.user!.householdId;
    const actorId = request.user!.id;

    // service: listItemsGrouped(householdId, actorId) -> GroupedItemsResponse
    //
    //   - Grouping belongs in SQL (one ordered query, grouped in a pass over the
    //     rows), not in N+1 queries per group.
    //   - An empty group is not returned: groups come from the items, so a
    //     category with nothing in it has no group. If the UI wants to render
    //     empty categories it should read them from GET /categories.
    //   - A group can be empty *after* the visibility filter — a category whose
    //     only items are another member's private ones. It is then not returned
    //     either, for the same reason: it does not exist in this member's view.
    void householdId;
    void actorId;
    return todo(reply, "GET /inventory/items/grouped");
  });

  app.post("/inventory/items", async (request, reply) => {
    const parsed = createItemBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const householdId = request.user!.householdId;
    const actorId = request.user!.id;

    // service: createItem(householdId, actorId, parsed.data) -> ItemWithAuthor
    //   - `household_id` is set from `householdId` and `added_by_user_id` from
    //     `actorId` (PRD §2.5.9). Attribution is written once here and never
    //     changed — no update path may touch it.
    //   - `is_private` comes from the body, defaulted to false by the schema. It
    //     is the one column here a caller does set, and it is meaningful only
    //     because `added_by_user_id` beside it is not.
    //   - 404 when category_id is not one of the HOUSEHOLD's categories. Not
    //     403: a foreign category id must be indistinguishable from a
    //     nonexistent one, or the response confirms it exists.
    //   - 201 + Location, then push to the household, filtered by visibility —
    //     an ordinary item to every member, a private one to its owner alone
    //     (§2.5.10).
    void householdId;
    void actorId;
    return todo(reply, "POST /inventory/items");
  });

  app.get("/inventory/items/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const householdId = request.user!.householdId;
    const actorId = request.user!.id;

    // service: getItem(householdId, actorId, parsed.data.id)
    //   -> InventoryItem | null
    // Scope the lookup by householdId AND the visibility filter in the query
    // itself, so both a foreign household's id and another member's private id
    // 404 without a second ownership branch anyone can forget to write. The two
    // cases are deliberately indistinguishable from a nonexistent row: a 403 on
    // the private one would tell the caller it is there.
    void householdId;
    void actorId;
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
    const householdId = request.user!.householdId;
    const actorId = request.user!.id;

    // service: updateItem(householdId, actorId, params.data.id, parsed.data)
    //   -> ItemWithAuthor | null
    // The row is found by the same household + visibility lookup GET uses, so a
    // row this member cannot see cannot be edited either. Beyond that the actor
    // grants nothing extra: an ordinary item is the household's, and any member
    // may edit it. There is no "only the adder may change it" rule — §2.5.9
    // makes attribution a record of who added it, not a claim on it.
    //
    // `is_private` is the one exception, and it must be enforced here: only the
    // member in `added_by_user_id` may set or clear it. Privacy is *defined*
    // against that column, so another member marking the row private would hide
    // it from the person who added it and from themselves at the same time —
    // a row nobody in the household can see. 403 rather than 404: the caller can
    // see this row, so refusing tells them nothing they did not already know.
    //
    // Quantity moved through here is a correction, not a stock movement:
    // last_updated belongs to POST /stock. Worth revisiting when the service
    // lands — it is the one place the two paths could diverge.
    void householdId;
    void actorId;
    return todo(reply, "PATCH /inventory/items/:id");
  });

  app.delete("/inventory/items/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const householdId = request.user!.householdId;
    const actorId = request.user!.id;

    // service: deleteItem(householdId, actorId, parsed.data.id) -> boolean
    // Same household + visibility lookup: invisible rows 404 rather than delete.
    // A mandate referencing the item does not cascade — that FK's behaviour is
    // the mandates module's call, so expect a 409 here later.
    void householdId;
    void actorId;
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
    const householdId = request.user!.householdId;
    const actorId = request.user!.id;

    // service: applyStockChange(householdId, actorId, params.data.id, parsed.data)
    //   -> InventoryItem | null
    // Same household + visibility lookup. Updates quantity + last_updated.
    // `delta` against a null quantity has no defined result — that is the case
    // to decide explicitly (422, or treat null as 0) rather than let it fall out
    // of the arithmetic.
    void householdId;
    void actorId;
    return todo(reply, "POST /inventory/items/:id/stock");
  });
};
