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

function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)sal_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

// Single-flight: refresh rotates the token, so parallel refreshes would present
// an already-rotated one and trip the server's replay detection.
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
      // Next tick, so every awaiting caller sees this result before a retry starts.
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
  const generic = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail[0]?.message) return String(detail[0].message);
  } catch {
    return generic;
  }
  return generic;
}

export const apiBaseUrl = BASE_URL;
