import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { streamResponse, type AgentMessage } from "../agent/index.js";
import { db } from "../db/client.js";
import * as messagesRepo from "../db/repositories/messages.js";
import * as sessionsRepo from "../db/repositories/sessions.js";

const clientMessage = z.object({ message: z.string() });
const uuidSchema = z.string().uuid();

export const websocketRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { session_id: string } }>(
    "/ws/:session_id",
    { websocket: true },
    (connection, request) => {
      const socket = connection.socket;
      const sessionId = request.params.session_id;

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
          const session = await sessionsRepo.getSession(tx, sessionId);
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
