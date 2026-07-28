/**
 * Guard-layer regression checks: token handling, PKCE, CSRF, Origin and auth
 * gating. Everything here short-circuits before a query runs, so it needs no
 * database — run it with `npm test`.
 */
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.ANTHROPIC_API_KEY = "sk-ant-dummy";
process.env.ALLOWED_ORIGINS = "http://localhost:5173";
process.env.JWT_SECRET = "test-secret-that-is-long-enough-32ch";

const { buildApp } = await import("../src/app.js");
const { signAccessToken, verifyAccessToken, mintRefreshToken, hashRefreshToken } = await import(
  "../src/auth/tokens.js"
);
const { createCodeVerifier, codeChallengeFor } = await import("../src/auth/google.js");

const app = await buildApp({ logger: false });
await app.ready();

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const cookieFrom = (res: { cookies: Array<{ name: string; value: string }> }, name: string) =>
  res.cookies.find((c) => c.name === name);

console.log("\ntokens");
{
  const jwt = await signAccessToken("user-123");
  check("access token round-trips", (await verifyAccessToken(jwt)) === "user-123");
  check("tampered token rejected", (await verifyAccessToken(jwt.slice(0, -2) + "xy")) === null);
  check("garbage token rejected", (await verifyAccessToken("not-a-jwt")) === null);

  const r = mintRefreshToken();
  check("refresh hash is deterministic", hashRefreshToken(r.token) === r.hash);
  check("refresh token is not its hash", r.token !== r.hash);
  check("refresh expiry ~30d", r.expiresAt.getTime() > Date.now() + 29 * 864e5);
}

console.log("\npkce");
{
  const v = createCodeVerifier();
  check("verifier length within 43-128", v.length >= 43 && v.length <= 128, `got ${v.length}`);
  check("challenge is deterministic", codeChallengeFor(v) === codeChallengeFor(v));
  check("challenge differs from verifier", codeChallengeFor(v) !== v);
}

console.log("\ncsrf bootstrap");
const meRes = await app.inject({ method: "GET", url: "/auth/me" });
const csrf = cookieFrom(meRes, "sal_csrf");
check("unauthenticated /auth/me is 401", meRes.statusCode === 401, `got ${meRes.statusCode}`);
check("GET mints a csrf cookie", Boolean(csrf?.value));
check("csrf cookie is readable by JS", csrf !== undefined && !("httpOnly" in csrf && csrf.httpOnly));

console.log("\ncsrf enforcement on mutations");
{
  const noToken = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "a@b.com", password: "x" },
  });
  check("mutation without csrf is 403", noToken.statusCode === 403, `got ${noToken.statusCode}`);

  const mismatch = await app.inject({
    method: "POST",
    url: "/auth/login",
    cookies: { sal_csrf: "aaa" },
    headers: { "x-csrf-token": "bbb" },
    payload: { email: "a@b.com", password: "x" },
  });
  check("mismatched csrf is 403", mismatch.statusCode === 403, `got ${mismatch.statusCode}`);

  const badOrigin = await app.inject({
    method: "POST",
    url: "/auth/login",
    cookies: { sal_csrf: "aaa" },
    headers: { "x-csrf-token": "aaa", origin: "https://evil.example" },
    payload: { email: "a@b.com", password: "x" },
  });
  check("foreign Origin is 403", badOrigin.statusCode === 403, `got ${badOrigin.statusCode}`);

  const goodOrigin = await app.inject({
    method: "POST",
    url: "/auth/login",
    cookies: { sal_csrf: "aaa" },
    headers: { "x-csrf-token": "aaa", origin: "http://localhost:5173" },
    payload: { email: "not-an-email", password: "x" },
  });
  check(
    "valid csrf + origin passes the guard (422 from zod, not 403)",
    goodOrigin.statusCode === 422,
    `got ${goodOrigin.statusCode}`,
  );
}

console.log("\nauth guards");
{
  const res = await app.inject({ method: "GET", url: "/sessions/not-a-uuid/history" });
  check("GET /sessions history requires auth", res.statusCode === 401, `got ${res.statusCode}`);

  const google = await app.inject({ method: "GET", url: "/auth/google" });
  check("/auth/google is 503 unconfigured", google.statusCode === 503, `got ${google.statusCode}`);

  const cb = await app.inject({ method: "GET", url: "/auth/google/callback" });
  check("callback without code redirects", cb.statusCode === 302, `got ${cb.statusCode}`);
  check(
    "callback redirect carries an error",
    (cb.headers.location as string)?.includes("error="),
    String(cb.headers.location),
  );
}

console.log("\ncors preflight");
{
  const res = await app.inject({
    method: "OPTIONS",
    url: "/auth/login",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-csrf-token",
    },
  });
  check("preflight allows credentials", res.headers["access-control-allow-credentials"] === "true");
  check(
    "preflight allows X-CSRF-Token",
    String(res.headers["access-control-allow-headers"] ?? "").toLowerCase().includes("x-csrf-token"),
    String(res.headers["access-control-allow-headers"]),
  );
}

await app.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
