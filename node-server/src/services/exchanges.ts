import { randomUUID } from "node:crypto";
import type { Turn } from "../agents/client.js";

export const turnLimit = 10;

const idleTimeout = 10 * 60 * 1000;
const reapInterval = 60 * 1000;

export type Exchange = {
  id: string;
  userId: string;
  turns: Turn[];
  lastUsed: number;
};

const open = new Map<string, Exchange>();

function openExchange(userId: string): Exchange {
  const exchange: Exchange = { id: randomUUID(), userId, turns: [], lastUsed: Date.now() };
  open.set(exchange.id, exchange);
  return exchange;
}

export function resumeExchange(userId: string, id: string | undefined): Exchange {
  const existing = id ? open.get(id) : undefined;
  if (!existing || existing.userId !== userId) return openExchange(userId);

  existing.lastUsed = Date.now();
  return existing;
}

export function turnsTaken(exchange: Exchange): number {
  return exchange.turns.filter((turn) => turn.role === "user").length;
}

export function isFinalTurn(exchange: Exchange): boolean {
  return turnsTaken(exchange) + 1 >= turnLimit;
}

export function recordTurn(exchange: Exchange, sentence: string, question: string): void {
  exchange.turns.push({ role: "user", content: sentence });
  exchange.turns.push({ role: "assistant", content: question });
  exchange.lastUsed = Date.now();
}

export function endExchange(exchange: Exchange): void {
  open.delete(exchange.id);
}

function reapIdleExchanges(): void {
  const cutoff = Date.now() - idleTimeout;
  for (const [id, exchange] of open) {
    if (exchange.lastUsed < cutoff) open.delete(id);
  }
}

setInterval(reapIdleExchanges, reapInterval).unref();
