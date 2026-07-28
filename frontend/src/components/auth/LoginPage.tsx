import { useState, FormEvent } from "react";
import { startGoogleLogin } from "../../api/auth";
import { useAuth } from "../../auth/useAuth";
import "./LoginPage.css";

/** Codes the backend appends to its /login redirect when OAuth fails. */
const OAUTH_ERRORS: Record<string, string> = {
  email_not_verified:
    "Google hasn't verified that email address, so we can't link it to an existing account. Sign in with your password instead.",
  google_auth_failed: "Google sign-in failed. Please try again.",
  state_mismatch: "That sign-in link expired. Please try again.",
  bad_state: "That sign-in link expired. Please try again.",
  missing_state: "That sign-in link expired. Please try again.",
  missing_code: "Google sign-in was cancelled.",
  access_denied: "Google sign-in was cancelled.",
  internal_error: "Something went wrong on our end. Please try again.",
};

function initialOAuthError(): string | null {
  const code = new URLSearchParams(window.location.search).get("error");
  if (!code) return null;
  return OAUTH_ERRORS[code] ?? "Sign-in failed. Please try again.";
}

export function LoginPage() {
  const { signIn, register } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(initialOAuthError);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        await register(email, password, displayName.trim() || undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-card__title">🦎Salamander</h1>
        <p className="login-card__subtitle">
          {mode === "signin" ? "Sign in to your account" : "Create an account"}
        </p>

        {error && (
          <p className="login-card__error" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="login-card__google" onClick={startGoogleLogin}>
          <span className="login-card__google-mark" aria-hidden="true">
            G
          </span>
          Continue with Google
        </button>

        <div className="login-card__divider">
          <span>or</span>
        </div>

        <form className="login-card__form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <label className="login-card__label">
              Name <span className="login-card__optional">(optional)</span>
              <input
                className="login-card__input"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </label>
          )}

          <label className="login-card__label">
            Email
            <input
              className="login-card__input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="login-card__label">
            Password
            <input
              className="login-card__input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              // Mirrors the server's zod rule so the failure is caught before a
              // round-trip; the server remains the actual enforcer.
              minLength={mode === "signup" ? 12 : undefined}
              required
            />
          </label>

          {mode === "signup" && (
            <p className="login-card__hint">At least 12 characters.</p>
          )}

          <button className="login-card__submit" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button type="button" className="login-card__switch" onClick={switchMode}>
          {mode === "signin"
            ? "Don't have an account? Create one"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
