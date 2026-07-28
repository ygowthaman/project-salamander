import { User } from "../types";
import { apiBaseUrl, apiFetch } from "./client";

export async function getMe(): Promise<User> {
  return apiFetch<User>("/auth/me");
}

export async function login(email: string, password: string): Promise<User> {
  return apiFetch<User>("/auth/login", { method: "POST", body: { email, password } });
}

export async function signup(
  email: string,
  password: string,
  displayName?: string,
): Promise<User> {
  return apiFetch<User>("/auth/signup", {
    method: "POST",
    body: { email, password, display_name: displayName || null },
  });
}

export async function logout(): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

/**
 * Full-page navigation rather than fetch: the OAuth flow is a redirect chain
 * through accounts.google.com, and the callback needs to be a top-level
 * navigation for the browser to accept the Set-Cookie that ends it.
 */
export function startGoogleLogin(): void {
  window.location.href = `${apiBaseUrl}/auth/google`;
}
