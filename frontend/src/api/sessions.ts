import { Session, Message } from "../types";
import { apiFetch } from "./client";

export async function createSession(): Promise<Session> {
  return apiFetch<Session>("/sessions", { method: "POST", body: {} });
}

export async function getHistory(sessionId: string): Promise<Message[]> {
  return apiFetch<Message[]>(`/sessions/${sessionId}/history`);
}
