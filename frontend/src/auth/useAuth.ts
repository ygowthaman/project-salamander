import { createContext, useContext } from "react";
import { User } from "../types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  promptHousehold: boolean;
  dismissHouseholdPrompt: () => void;
  applyUser: (user: User) => void;
}

// Kept out of AuthContext.tsx: mixing component and non-component exports in one
// file breaks React Fast Refresh.
export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside an AuthProvider");
  return ctx;
}
