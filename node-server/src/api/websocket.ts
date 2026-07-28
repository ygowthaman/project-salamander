import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { streamResponse, type AgentMessage } from "../agent/index.js";
import { allowedOrigins, requireAuth } from "../auth/plugin.js";
import { db } from "../db/client.js";
import * as messagesRepo from "../db/repositories/messages.js";
import * as sessionsRepo from "../db/repositories/sessions.js";

const clientMessage = z.object({ message: z.string() });
const uuidSchema = z.string().uuid();

export const websocketRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { session_id: string } }>(
    "/ws/:session_id",
    {
      websocket: true,
      // Authenticate at the handshake, before the upgrade completes: the auth
      // cookie rides along with the upgrade request, so an unauthenticated
      // client never gets a socket at all.
      preHandler: async (request, reply) => {
        // A cross-site page must not be able to open an authenticated socket.
        // CORS does not apply to WebSockets, so this check is the only thing
        // standing between an attacker's page and the user's cookie.
        const origin = request.headers.origin;
        if (origin && !allowedOrigins().includes(origin)) {
          return reply.code(403).send({ detail: "Origin not allowed" });
        }
        return requireAuth(request, reply);
      },
    },
    (connection, request) => {
      const socket = connection.socket;
      const sessionId = request.params.session_id;
      const userId = request.user!.id;

      const send = (payload: unknown) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      };

      // The socket is long-lived and `message` events can arrive while a turn
      // is still streaming; chain them so turns are handled strictly in order.
      let queue: Promise<void> = Promise.resolve();

      socket.on("message", (raw: Buffer | string) => {
        queue = queue
          .then(() => handleMessage(raw.toString()))
          .catch((err) => {
            request.log.error({ err }, "websocket turn failed");
            send({ type: "error", message: "Internal server error" });
          });
      });

      async function handleMessage(raw: string): Promise<void> {
        const parsed = clientMessage.safeParse(safeJsonParse(raw));
        if (!parsed.success) {
          send({ type: "error", message: "Invalid message" });
          return;
        }
        const userMessage = parsed.data.message;

        if (!uuidSchema.safeParse(sessionId).success) {
          send({ type: "error", message: "Session not found" });
          return;
        }

        // Each incoming message gets its own scoped transaction rather than one
        // held open for the socket's lifetime.
        const history = await db.transaction(async (tx) => {
          // Ownership is re-checked every turn, not just at the handshake: the
          // socket outlives the 15-minute access token, and the account may be
          // deleted mid-connection (which cascades this session away).
          const session = await sessionsRepo.getSessionForUser(tx, sessionId, userId);
          if (!session) return null;

          const prior = await messagesRepo.getHistory(tx, sessionId);
          await messagesRepo.saveMessage(tx, sessionId, "user", userMessage);
          return prior;
        });

        if (history === null) {
          // Session lookup failed — report it but keep the connection open.
          send({ type: "error", message: "Session not found" });
          return;
        }

        const llmMessages: AgentMessage[] = [
          ...history.map((m) => ({ role: m.role as AgentMessage["role"], content: m.content })),
          { role: "user" as const, content: userMessage },
        ];

        let fullResponse = "";
        for await (const chunk of streamResponse(llmMessages)) {
          fullResponse += chunk;
          send({ type: "chunk", text: chunk });
        }

        await db.transaction(async (tx) => {
          await messagesRepo.saveMessage(tx, sessionId, "assistant", fullResponse);
        });

        send({ type: "done" });
      }
    },
  );
};

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
