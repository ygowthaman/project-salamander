import { User } from "../types";
import { apiBaseUrl, apiFetch } from "./client";

export async function getMe(): Promise<User> {
  return apiFetch<User>("/auth/me");
}

export async function login(email: string, password: string): Promise<User> {
  return apiFetch<User>("/auth/login", { method: "POST", body: { email, password } });
}

/**
 * `account_created` is what the household setup form keys on, and it is reported
 * by the server rather than inferred here: the question is asked once, at the
 * moment an account comes into existence.
 *
 * It cannot be derived from `skip_household` — a user who was asked and skipped
 * and a user who was never asked both sit at `true`, so keying the form on that
 * would either re-ask at every sign-in or never ask at all.
 */
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

/**
 * Full-page navigation rather than fetch: the OAuth flow is a redirect chain
 * through accounts.google.com, and the callback needs to be a top-level
 * navigation for the browser to accept the Set-Cookie that ends it.
 */
export function startGoogleLogin(): void {
  window.location.href = `${apiBaseUrl}/auth/google`;
}
