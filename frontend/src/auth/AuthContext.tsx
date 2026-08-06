import { useCallback, useEffect, useState, ReactNode } from "react";
import * as authApi from "../api/auth";
import { User } from "../types";
import { AuthContext, AuthStatus } from "./useAuth";

// Module scope, not an effect or state initialiser: this rewrites history, and
// StrictMode runs both of those twice.
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

  // Also mints the CSRF cookie the login form needs, so it must precede any
  // mutation.
  useEffect(() => {
    let cancelled = false;
    authApi
      .getMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
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
