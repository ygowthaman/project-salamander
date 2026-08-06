import { User } from "../types";
import { apiBaseUrl, apiFetch } from "./client";

export async function getMe(): Promise<User> {
  return apiFetch<User>("/auth/me");
}

export async function login(email: string, password: string): Promise<User> {
  return apiFetch<User>("/auth/login", { method: "POST", body: { email, password } });
}

interface SignupResponse extends User {
  account_created?: boolean;
}

export async function signup(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ user: User; accountCreated: boolean }> {
  const { account_created, ...user } = await apiFetch<SignupResponse>("/auth/signup", {
    method: "POST",
    body: { email, password, display_name: displayName || null },
  });
  return { user, accountCreated: account_created === true };
}

export async function logout(): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export function startGoogleLogin(): void {
  window.location.href = `${apiBaseUrl}/auth/google`;
}
