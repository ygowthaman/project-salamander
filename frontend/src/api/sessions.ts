import { Session, Message } from "../types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export async function createSession(): Promise<Session> {
  const res = await fetch(`${BASE_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error("Failed to create session");
  return res.json();
}

export async function getHistory(sessionId: string): Promise<Message[]> {
  const res = await fetch(`${BASE_URL}/sessions/${sessionId}/history`);
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}
