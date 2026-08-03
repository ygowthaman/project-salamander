import { createContext, useContext } from "react";
import { User } from "../types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Whether *this* visit is the one that created the account, and therefore
   * whether the household setup form is still owed an answer.
   *
   * Both ways in report it — password sign-up in its response body, Google in a
   * query parameter on the callback redirect — so the form appears once, on
   * first entry, no matter which route the user took. Signing in with Google for
   * the tenth time is indistinguishable from signing in with a password for the
   * tenth time: nothing is asked.
   *
   * Lives here rather than in the component that renders the form because
   * account creation is an auth fact, and it is the only fact the form needs.
   */
  promptHousehold: boolean;
  /**
   * Answers the household question — by creating one or by skipping — so it is
   * not asked again. Skipping is an answer, not a deferral; a user who skips is
   * not re-prompted on their next sign-in, and reaches the form afterwards only
   * on their own initiative.
   */
  dismissHouseholdPrompt: () => void;
  /** Replaces the cached user after a mutation returns an updated row. */
  applyUser: (user: User) => void;
}

// Kept out of AuthContext.tsx so that file exports only a component — mixing
// component and non-component exports breaks React Fast Refresh.
export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
}
