import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { publicUser, requireAuth } from "../auth/plugin.js";
import type { Household, User } from "../db/schema/index.js";
import { HouseholdError } from "../services/households.js";
import * as households from "../services/households.js";

// The REST surface for the household module (PRD §2.2, §2.3). HTTP concerns
// only: parse, validate, bind the caller, shape the response. Every rule —
// who may do what, and what a departure does — is in `services/households.ts`.
//
// **Singular, and with no id in any path.** A user belongs to exactly one
// household, and which one is resolved server-side from the session; there is
// deliberately no `/households/:id` for a caller to point somewhere else. The
// member routes take a *user* id, which is scoped to the caller's household in
// the query that fetches it, so an id from another household is indistinguishable
// from one that does not exist.
//
// Not routed here: **invitations** (§2.2.6). They need a table the schema does
// not have and are blocked on SMTP and the notifications module — see the note
// at the top of the service.

// ---- Schemas ---------------------------------------------------------------

const memberParams = z.object({
  user_id: z.string().uuid(),
});

// Name is mandatory: a household always has one, because it is what the UI calls
// the scope in every list and header. Address is optional and a household
// without one is normal rather than incomplete, so `.nullish()` — explicit null
// clears it, an absent key leaves it alone.
const createHouseholdBody = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(500).nullish(),
});

const updateHouseholdBody = createHouseholdBody
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "At least one field must be provided" });

const roleBody = z.object({
  role: z.enum(["admin", "user"]),
});

// ---- Serialisation ---------------------------------------------------------

/** Row → wire shape. snake_case and ISO timestamps, matching the auth routes. */
function publicHousehold(household: Household) {
  return {
    id: household.id,
    name: household.name,
    address: household.address,
    created_at: household.createdAt.toISOString(),
    updated_at: household.updatedAt.toISOString(),
  };
}

/**
 * A member as other members see them.
 *
 * The email is included because it is how a person is identified for an invite
 * and often the only thing distinguishing two members with the same first name;
 * it is shared within a household the user is already in, and nowhere else.
 * `password_hash` and the session columns are not on `users` rows this shape can
 * reach — see `publicUser` for the same guarantee on the account routes.
 */
function publicMember(member: User, selfId: string) {
  return {
    id: member.id,
    email: member.email,
    display_name: member.displayName,
    avatar_url: member.avatarUrl,
    role: member.role,
    is_self: member.id === selfId,
    created_at: member.createdAt.toISOString(),
  };
}

// ---- Routes ----------------------------------------------------------------

export const householdRoutes: FastifyPluginAsync = async (app) => {
  // A household is only ever reachable through membership of it. There is no
  // anonymous read here and no route that omits this hook.
  app.addHook("preHandler", requireAuth);

  // Scoped to this plugin's encapsulation context, so it maps the service's
  // rules onto status codes without touching the rest of the app. Anything that
  // is not a HouseholdError and carries no status of its own is a bug, and is
  // logged and reported as a 500 rather than leaked to the client.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HouseholdError) {
      return reply.code(error.status).send({ detail: error.detail });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ detail: error.message });
    }
    request.log.error({ err: error }, "household route failed");
    return reply.code(500).send({ detail: "Internal server error" });
  });

  /**
   * The caller's household. Always present — every user has one (§2.2), so this
   * never 404s in practice, and a client does not need a "no household" branch.
   *
   * `skip_household` is what the UI branches on, not the presence of this
   * response: a user who was given a household silently must not be shown
   * household features or a name they never chose, even though the data behind
   * them is identical to a user who created one.
   */
  app.get("/household", async (request) => {
    const summary = await households.getHousehold(request.user!);
    return {
      ...publicHousehold(summary.household),
      member_count: summary.memberCount,
      admin_count: summary.adminCount,
      role: request.user!.role,
      skip_household: request.user!.skipHousehold,
      // What the UI needs to warn a departing admin that leaving — or deleting
      // their account — dissolves the household and destroys its inventory
      // (§2.2.10). Nobody's account goes with it; everyone still in it is
      // re-homed.
      is_last_admin: summary.isLastAdmin,
    };
  });

  /**
   * The create form (§2.2.1 on first entry, §2.2.4 later). A rename of the row
   * the caller already has, never an insert — nothing is re-parented, and their
   * existing inventory stays exactly where it is.
   *
   * 200 rather than 201: no resource comes into existence here, and answering
   * with a Location the client already knows would misdescribe what happened.
   * The updated user comes back alongside it because `skip_household` changed,
   * and the SPA holds that on its session object.
   */
  app.post("/household", async (request, reply) => {
    const parsed = createHouseholdBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }

    const { household, user } = await households.createHousehold(request.user!, {
      name: parsed.data.name,
      address: parsed.data.address ?? null,
    });
    return { household: publicHousehold(household), user: publicUser(user) };
  });

  /**
   * Rename or re-address, from the management page. Open to both roles: §2.3.1
   * grants the admin role four specific powers and this is not one of them.
   */
  app.patch("/household", async (request, reply) => {
    const parsed = updateHouseholdBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const { name, address } = parsed.data;

    const household = await households.updateHousehold(request.user!, {
      ...(name === undefined ? {} : { name }),
      ...(address === undefined ? {} : { address }),
    });
    return publicHousehold(household);
  });

  /**
   * Deletes the household and its data (§2.2.8). `admin` only.
   *
   * **No account is deleted, including the caller's own.** Every member keeps
   * their sign-in and is re-homed into a silent household of their own, so the
   * session that made this request is still valid afterwards — the cookies stay
   * exactly where they are.
   *
   * The response carries the caller's re-homed user for the same reason
   * `POST /household/leave` does: `household_id`, `role` and `skip_household`
   * have all changed, and a client that keeps the old one renders a household
   * that no longer exists.
   */
  app.delete("/household", async (request) => {
    const user = await households.deleteHousehold(request.user!);
    return { ok: true, user: publicUser(user) };
  });

  // ---- Members -------------------------------------------------------------

  app.get("/household/members", async (request) => {
    const members = await households.listMembers(request.user!);
    return { members: members.map((m) => publicMember(m, request.user!.id)) };
  });

  /**
   * Promote or demote a member (§2.3.3). `admin` only, and any admin may change
   * any member's role including their own — the sole refusal is demoting the
   * last admin, which is a 409.
   */
  app.patch("/household/members/:user_id/role", async (request, reply) => {
    const params = memberParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ detail: params.error.issues });
    }
    const parsed = roleBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }

    const member = await households.setMemberRole(
      request.user!,
      params.data.user_id,
      parsed.data.role,
    );
    return publicMember(member, request.user!.id);
  });

  /**
   * Remove a member (§2.2.10). `admin` only, and never yourself — that is
   * `POST /household/leave`, which is a different operation because only leaving
   * can dissolve the household.
   *
   * The response says where they went, not what was destroyed, because nothing
   * is: they keep their account and land in a household of their own, and
   * everything they added stays here.
   */
  app.delete("/household/members/:user_id", async (request, reply) => {
    const params = memberParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ detail: params.error.issues });
    }

    const removed = await households.removeMember(request.user!, params.data.user_id);
    return { ok: true, removed_user_id: removed.id };
  });

  /**
   * Leave the household (§2.2.10). Both roles.
   *
   * The caller stays signed in — they keep their account, so their session is
   * still valid and simply resolves to a different household on the next
   * request. The new user row comes back so the SPA can update `household_id`,
   * `role` and `skip_household` without a round trip to `/auth/me`.
   *
   * `previous_household_destroyed` reports the last-admin case. It is a result,
   * not a question: the warning belongs in front of this call, driven by
   * `is_last_admin` on `GET /household`.
   */
  app.post("/household/leave", async (request) => {
    const departure = await households.leaveHousehold(request.user!);
    return {
      ok: true,
      household: publicHousehold(departure.household),
      user: publicUser(departure.user),
      previous_household_destroyed: departure.previousHouseholdDestroyed,
    };
  });
};
