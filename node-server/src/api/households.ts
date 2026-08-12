import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { publicUser, requireAuth } from "../auth/plugin.js";
import type { Household, User } from "../db/schema/index.js";
import { HouseholdError } from "../services/households.js";
import * as households from "../services/households.js";

const memberParams = z.object({
  user_id: z.string().uuid(),
});

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

function publicHousehold(household: Household) {
  return {
    id: household.id,
    name: household.name,
    address: household.address,
    created_at: household.createdAt.toISOString(),
    updated_at: household.updatedAt.toISOString(),
  };
}

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

export const householdRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

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

  app.get("/households", async (request) => {
    const summary = await households.getHousehold(request.user!);
    return {
      ...publicHousehold(summary.household),
      member_count: summary.memberCount,
      admin_count: summary.adminCount,
      role: request.user!.role,
      skip_household: request.user!.skipHousehold,
      is_last_admin: summary.isLastAdmin,
    };
  });

  app.post("/households", async (request, reply) => {
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

  app.patch("/households", async (request, reply) => {
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

  app.delete("/households", async (request) => {
    const user = await households.deleteHousehold(request.user!);
    return { ok: true, user: publicUser(user) };
  });

  app.get("/households/members", async (request) => {
    const members = await households.listMembers(request.user!);
    return { members: members.map((m) => publicMember(m, request.user!.id)) };
  });

  app.patch("/households/members/:user_id/role", async (request, reply) => {
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

  app.delete("/households/members/:user_id", async (request, reply) => {
    const params = memberParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ detail: params.error.issues });
    }

    const removed = await households.removeMember(request.user!, params.data.user_id);
    return { ok: true, removed_user_id: removed.id };
  });

  app.post("/households/leave", async (request) => {
    const departure = await households.leaveHousehold(request.user!);
    return {
      ok: true,
      household: publicHousehold(departure.household),
      user: publicUser(departure.user),
      previous_household_destroyed: departure.previousHouseholdDestroyed,
    };
  });
};
