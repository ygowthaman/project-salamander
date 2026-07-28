import { useCallback, useEffect, useState, ReactNode } from "react";
import * as authApi from "../api/auth";
import { User } from "../types";
import { AuthContext, AuthStatus } from "./useAuth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

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
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      setUser(await authApi.signup(email, password, displayName));
      setStatus("authenticated");
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Drop local state even if the request failed — the cookies are gone or
      // unusable either way, and leaving a stale user on screen is worse.
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, signIn, register, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
