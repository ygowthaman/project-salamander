const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The CSRF cookie is intentionally readable by JS — the server sets it without
 * httpOnly precisely so it can be echoed back in a header. A cross-origin
 * attacker can neither read it nor set the header, which is what makes the
 * double-submit check meaningful.
 */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)sal_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

/**
 * Single-flight refresh. Several requests can 401 at once when the 15-minute
 * access token expires; without this they would each POST /auth/refresh, and
 * because refresh rotates the token, the later ones would present an
 * already-rotated token and trip the server's replay detection — logging the
 * user out instead of renewing them.
 */
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: csrfToken() ? { "X-CSRF-Token": csrfToken()! } : {},
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all observe
      // the same result before a new attempt can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();
  return refreshInFlight;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Internal: prevents a refresh loop when the refresh itself is what failed. */
  allowRetry?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (MUTATING.has(method)) {
    const token = csrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    // Sends the auth cookies. Works cross-subdomain because the frontend and
    // backend share the axoliz.ai registrable domain in production.
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (res.status === 401 && (options.allowRetry ?? true) && !path.startsWith("/auth/refresh")) {
    if (await refreshSession()) {
      return apiFetch<T>(path, { ...options, allowRetry: false });
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res));
  }

  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    // zod issues come back as an array; surface the first message.
    if (Array.isArray(detail) && detail[0]?.message) return String(detail[0].message);
  } catch {
    // Fall through to the generic message.
  }
  return `Request failed (${res.status})`;
}

export const apiBaseUrl = BASE_URL;
