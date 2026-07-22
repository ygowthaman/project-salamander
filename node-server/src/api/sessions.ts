import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../db/client.js";
import * as messagesRepo from "../db/repositories/messages.js";
import * as sessionsRepo from "../db/repositories/sessions.js";

const createSessionBody = z.object({
  title: z.string().nullish(),
});

const sessionIdParams = z.object({
  session_id: z.string().uuid(),
});

export const sessionsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/sessions", async (request, reply) => {
    const parsed = createSessionBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }

    const session = await sessionsRepo.createSession(db, parsed.data.title || "New Session");

    return {
      id: session.id,
      title: session.title,
      created_at: session.createdAt.toISOString(),
    };
  });

  app.get("/sessions/:session_id/history", async (request, reply) => {
    const parsed = sessionIdParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const sessionId = parsed.data.session_id;

    const session = await sessionsRepo.getSession(db, sessionId);
    if (!session) {
      return reply.code(404).send({ detail: "Session not found" });
    }

    const history = await messagesRepo.getHistory(db, sessionId);

    return history.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.createdAt.toISOString(),
    }));
  });
};
