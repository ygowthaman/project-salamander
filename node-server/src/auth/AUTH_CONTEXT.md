# Auth Context

This folder owns identity: who the caller is, and whether they may act. It knows
nothing about chat, sessions or the agent — routes import from here, never the
reverse.

## Divergence from the PRD

`docs/PRD.md` §1 locks authentication to **email + password only**, and §9 lists
*"third-party / social login (OAuth)"* as an explicit **non-goal**. Both were
overridden by the maintainer: this implementation ships **Google OAuth *and*
email+password together**. The PRD's §3 design (JWT access token in an httpOnly
cookie, revocable refresh records in `auth_sessions`, CSRF defence in depth) is
otherwise followed as written, and OAuth is layered on as a second way to prove
identity rather than a replacement.

## Why cookies, and why the domain matters

The access token is a short-lived (15 min) JWT in an **httpOnly** cookie, so no
token is reachable from JavaScript and the WebSocket upgrade carries it
automatically — a browser cannot set headers on a `new WebSocket()` call, so a
bearer token would have needed a query parameter or subprotocol hack.

`SameSite=Lax` cookies are **not sent on cross-site requests**. The frontend
(`salamander.axoliz.ai`, Firebase Hosting) and backend must therefore share a
registrable domain, which is why the backend is mapped to **`api.axoliz.ai`**
rather than being called on its `*.run.app` URL — `run.app` is on the Public
Suffix List, so `foo.run.app` and `axoliz.ai` are different sites and every
authenticated request would silently 401. `COOKIE_DOMAIN=axoliz.ai` is what ties
the two together; locally it is empty because both sides are `localhost`.

## Refresh rotation and replay detection

Refresh tokens are opaque random bytes, not JWTs: they are looked up in
`auth_sessions` on every use, so revocation is a row update rather than a
blocklist. Only a SHA-256 of the token is stored — plain SHA-256 rather than
argon2 because the input is 256 bits of our own entropy, so there is nothing to
brute force and a slow KDF would only tax every refresh.

Each refresh **rotates**: the presented record is revoked and a new one issued.
Presenting an already-revoked token therefore means either a self-race or a
leak, and the server assumes the worst — it revokes *every* session for that
user. The frontend's single-flight refresh (`api/client.ts`) exists to prevent
the benign version of that race from logging people out.

## Password verification is deliberately constant-cost

`verifyPassword` runs a real argon2 comparison against a dummy hash when the
account has no password. Returning early would make "this is a Google-only
account" and "no such user" measurably faster than "wrong password" and leak
account existence through timing — which would undo the identical-401 rule that
`/auth/login` follows for the same reason.

## OAuth account linking is keyed on `sub`, never email

`oauth_accounts` is keyed on Google's `sub` claim, which is stable for the life
of the Google account. Matching on email instead would silently re-point a link
if a user changed their Google address.

When a Google identity arrives whose email matches an existing password account,
the two are linked **only if Google asserts `email_verified`**. Without that
check, anyone able to create a Google account claiming an address could take over
the matching Salamander account. An unverified match is refused and surfaced to
the user as `?error=email_not_verified`.

The ID token is verified against Google's JWKS with both issuer **and audience**
checked. The audience check is the load-bearing one: without it, an ID token
minted for someone else's OAuth client would be accepted here.

## CSRF

Cookies are attached by the browser automatically, so mutations need more than
`SameSite`. Three layers, per PRD §3.4:

1. `SameSite=Lax` on every auth cookie.
2. A **double-submit token** — a non-httpOnly `sal_csrf` cookie the frontend
   echoes in `X-CSRF-Token`. It is readable by JS on purpose; an attacker on
   another origin can neither read it nor set the header without passing CORS
   preflight. The server mints one on any request arriving without it, which is
   why the SPA's bootstrap `GET /auth/me` must precede its first mutation.
3. An **Origin check** against `ALLOWED_ORIGINS` on every mutating request, and
   at the WebSocket handshake — CORS does not apply to WebSockets, so that check
   is the only thing stopping a cross-site page opening an authenticated socket.

`/auth/google` and `/auth/google/callback` are exempt: they are GETs driven by
Google and cannot carry a header. The callback is protected instead by the
`state` parameter, compared against a signed httpOnly cookie that also carries
the PKCE verifier.

## Files

- **config.ts** — env resolution. Google credentials are optional, so the server
  boots without an OAuth client and `/auth/google` reports 503.
- **tokens.ts** — access-JWT sign/verify, refresh mint/hash, random tokens.
- **cookies.ts** — every cookie name, scope and flag. The refresh cookie is
  path-scoped to `/auth` so it is not attached to ordinary API or WS requests.
- **password.ts** — argon2id via `@node-rs/argon2` (prebuilt binaries, so no
  node-gyp toolchain locally or in the Cloud Buildpacks build).
- **google.ts** — authorize URL with PKCE, code exchange, ID-token verification.
- **plugin.ts** — registers cookie parsing and the global identify/CSRF hooks on
  the *root* Fastify instance. Deliberately not a `fastify-plugin` wrapper:
  registering on the root avoids another dependency just to break encapsulation.

## Testing

`npm test` runs `test/auth-guards.ts` — token round-trips, PKCE, CSRF rejection,
Origin rejection, auth gating and the CORS preflight. Every case short-circuits
before a query, so it needs **no database**. Flows that do touch the database
(signup, login, the OAuth callback, refresh rotation) are **not yet covered** and
remain the biggest gap here.
