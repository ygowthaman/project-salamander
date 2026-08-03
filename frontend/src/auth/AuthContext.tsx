import { useCallback, useEffect, useState, ReactNode } from "react";
import * as authApi from "../api/auth";
import { User } from "../types";
import { AuthContext, AuthStatus } from "./useAuth";

/**
 * Google's half of "this request created the account".
 *
 * The callback leg is a redirect, not a JSON reply, so the server reports it as
 * `?new_account=1` on the URL it sends the browser back to. Read once at module
 * load and stripped from the address bar immediately: leaving it there would
 * re-open the household form on every refresh, and the question is meant to be
 * asked exactly once.
 *
 * At module scope rather than in a state initialiser or an effect because it
 * mutates history — under StrictMode both of those run twice in development,
 * and this must not.
 */
const CREATED_VIA_OAUTH = consumeNewAccountParam();

function consumeNewAccountParam(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.get("new_account") !== "1") return false;

  params.delete("new_account");
  const query = params.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
  );
  return true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [promptHousehold, setPromptHousehold] = useState(false);

  // Bootstrap from the cookie. This is also what mints the CSRF cookie for the
  // login form: the server sets it on any request that arrives without one, so
  // this GET has to happen before the first mutation.
  useEffect(() => {
    let cancelled = false;
    authApi
      .getMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
        // Only now, because the redirect flag alone proves nothing: if the
        // cookie did not resolve to a user we are on the login screen, and the
        // flag must not survive to greet whoever signs in next.
        setPromptHousehold(CREATED_VIA_OAUTH);
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setUser(await authApi.login(email, password));
    setStatus("authenticated");
    // An existing account, by definition. Clearing rather than leaving it alone
    // covers the case where a stale OAuth flag is still set from a callback that
    // did not sign anyone in.
    setPromptHousehold(false);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    const { user: created, accountCreated } = await authApi.signup(email, password, displayName);
    setUser(created);
    setStatus("authenticated");
    setPromptHousehold(accountCreated);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Drop local state even if the request failed — the cookies are gone or
      // unusable either way, and leaving a stale user on screen is worse.
      setUser(null);
      setStatus("anonymous");
      setPromptHousehold(false);
    }
  }, []);

  const dismissHouseholdPrompt = useCallback(() => setPromptHousehold(false), []);

  const applyUser = useCallback((next: User) => setUser(next), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        signIn,
        register,
        signOut,
        promptHousehold,
        dismissHouseholdPrompt,
        applyUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
