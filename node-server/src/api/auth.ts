import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authConfig } from "../auth/config.js";
import {
  OAUTH_STATE_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  clearOAuthStateCookie,
  setAuthCookies,
  setCsrfCookie,
  setOAuthStateCookie,
} from "../auth/cookies.js";
import {
  GoogleAuthError,
  buildAuthorizeUrl,
  createCodeVerifier,
  exchangeCodeForProfile,
  isGoogleConfigured,
} from "../auth/google.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { publicUser, requireAuth } from "../auth/plugin.js";
import { hashRefreshToken, mintRefreshToken, randomToken, signAccessToken } from "../auth/tokens.js";
import { db } from "../db/client.js";
import * as authSessionsRepo from "../db/repositories/authSessions.js";
import * as householdsRepo from "../db/repositories/households.js";
import * as oauthRepo from "../db/repositories/oauthAccounts.js";
import * as usersRepo from "../db/repositories/users.js";

const signupBody = z.object({
  email: z.string().email().max(320),
  // Long minimum instead of composition rules: length is what actually resists
  // offline cracking, and this account will eventually authorise spending.
  password: z.string().min(12).max(200),
  display_name: z.string().trim().min(1).max(100).nullish(),
});

const loginBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

const patchMeBody = z.object({
  display_name: z.string().trim().min(1).max(100).nullish(),
  email: z.string().email().max(320).optional(),
});

const changePasswordBody = z.object({
  current_password: z.string().max(200).optional(),
  new_password: z.string().min(12).max(200),
});

const deleteMeBody = z.object({
  password: z.string().max(200).optional(),
  confirm: z.string().optional(),
});

/** Mints a refresh record plus access/CSRF cookies. The one place a login is granted. */
async function issueSession(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  const refresh = mintRefreshToken();

  await authSessionsRepo.createAuthSession(db, {
    userId,
    refreshTokenHash: refresh.hash,
    expiresAt: refresh.expiresAt,
    userAgent: request.headers["user-agent"] ?? null,
    ip: request.ip,
  });

  setAuthCookies(reply, {
    accessToken: await signAccessToken(userId),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  });
  // Rotate the CSRF token alongside the session so a pre-login token cannot be
  // carried over (session-fixation style) into the authenticated session.
  setCsrfCookie(reply, randomToken());
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/auth/signup",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = signupBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(422).send({ detail: parsed.error.issues });
      }
      const { email, password, display_name } = parsed.data;

      if (await usersRepo.getUserByEmail(db, email)) {
        return reply.code(409).send({ detail: "An account with that email already exists" });
      }

      const passwordHash = await hashPassword(password);
      // One transaction: an account and the household that owns its data are
      // created together, so there is no window in which a user row exists with
      // nothing to own. The household is auto-provisioned and `skip_household`
      // is true — the create form is shown *after* this, on first entry, and
      // answering it renames this row rather than making a second one
      // (PRD §2.2.1, §2.2.4). Hashing is done outside the transaction so an
      // argon2 pass never holds a pooled connection open.
      const { user } = await db.transaction((tx) =>
        householdsRepo.createUserWithHousehold(tx, {
          email,
          passwordHash,
          displayName: display_name ?? null,
        }),
      );

      await issueSession(request, reply, user.id);
      return reply.code(201).send({ ...publicUser(user), account_created: true });
    },
  );

  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "15 minutes",
          // Runs late enough that the body is parsed, so the limit can be keyed
          // to the targeted account — an IP-only key would let a botnet brute
          // force one account from many addresses. Falls back to IP when the
          // body is unusable. The global limiter in server.ts covers the
          // inverse case (one IP probing many accounts).
          hook: "preHandler" as const,
          keyGenerator: (request: FastifyRequest) => {
            const body = request.body as { email?: unknown } | undefined;
            return typeof body?.email === "string" ? body.email.toLowerCase() : request.ip;
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = loginBody.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(422).send({ detail: parsed.error.issues });
      }
      const { email, password } = parsed.data;

      const user = await usersRepo.getUserByEmail(db, email);
      // verifyPassword burns the same time on a null hash, so "no such user",
      // "OAuth-only account" and "wrong password" are indistinguishable in both
      // response and timing.
      const ok = await verifyPassword(user?.passwordHash ?? null, password);
      if (!user || !ok) {
        return reply.code(401).send({ detail: "Invalid email or password" });
      }

      await issueSession(request, reply, user.id);
      return publicUser(user);
    },
  );

  // ---- Google OAuth -------------------------------------------------------

  app.get("/auth/google", async (request, reply) => {
    if (!isGoogleConfigured()) {
      return reply.code(503).send({ detail: "Google sign-in is not configured" });
    }

    const state = randomToken();
    const codeVerifier = createCodeVerifier();

    // Both halves live in one signed, httpOnly cookie: `state` defends the
    // callback against CSRF, and the PKCE verifier never leaves this server.
    setOAuthStateCookie(reply, JSON.stringify({ state, codeVerifier }));

    return reply.redirect(buildAuthorizeUrl({ state, codeVerifier }));
  });

  app.get("/auth/google/callback", async (request, reply) => {
    const loginUrl = `${authConfig.frontendUrl}/login`;
    const fail = (reason: string) =>
      reply.redirect(`${loginUrl}?error=${encodeURIComponent(reason)}`);

    const query = request.query as { code?: string; state?: string; error?: string };
    if (query.error) return fail(query.error);
    if (!query.code || !query.state) return fail("missing_code");

    const raw = request.cookies[OAUTH_STATE_COOKIE];
    clearOAuthStateCookie(reply);
    if (!raw) return fail("missing_state");

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return fail("bad_state");

    let stored: { state: string; codeVerifier: string };
    try {
      stored = JSON.parse(unsigned.value);
    } catch {
      return fail("bad_state");
    }
    if (stored.state !== query.state) return fail("state_mismatch");

    let profile;
    try {
      profile = await exchangeCodeForProfile(query.code, stored.codeVerifier);
    } catch (err) {
      request.log.error({ err }, "google oauth exchange failed");
      return fail(err instanceof GoogleAuthError ? "google_auth_failed" : "internal_error");
    }

    // `created` drives the household step: PRD §2.2.1 keys the create form on
    // an account coming into existence, not on a first-login check, so signing
    // in with Google for the tenth time asks nothing. It is reported to the SPA
    // as a query parameter because this leg is a redirect, not a JSON reply.
    let created = false;

    const userId = await db.transaction(async (tx) => {
      const existingLink = await oauthRepo.getByProviderAccount(tx, oauthRepo.GOOGLE, profile.sub);
      if (existingLink) return existingLink.userId;

      const byEmail = await usersRepo.getUserByEmail(tx, profile.email);

      if (byEmail) {
        // Auto-linking an unverified Google email to an existing password
        // account is an account-takeover vector: anyone able to create a Google
        // account claiming that address would inherit the account. Only link
        // when Google asserts the address is verified.
        if (!profile.emailVerified) return null;

        await oauthRepo.linkAccount(tx, {
          userId: byEmail.id,
          provider: oauthRepo.GOOGLE,
          providerAccountId: profile.sub,
        });
        // Backfill profile fields the password signup never collected.
        await usersRepo.updateUser(tx, byEmail.id, {
          emailVerified: true,
          displayName: byEmail.displayName ?? profile.name,
          avatarUrl: byEmail.avatarUrl ?? profile.picture,
        });
        return byEmail.id;
      }

      // Same account-and-household transaction as password signup: a Google
      // user is not quietly opted into skipping just because their route in had
      // no form to hang the household question on.
      const { user } = await householdsRepo.createUserWithHousehold(tx, {
        email: profile.email,
        passwordHash: null,
        displayName: profile.name,
        avatarUrl: profile.picture,
        emailVerified: profile.emailVerified,
      });
      await oauthRepo.linkAccount(tx, {
        userId: user.id,
        provider: oauthRepo.GOOGLE,
        providerAccountId: profile.sub,
      });
      created = true;
      return user.id;
    });

    if (!userId) return fail("email_not_verified");

    await issueSession(request, reply, userId);
    return reply.redirect(created ? `${authConfig.frontendUrl}?new_account=1` : authConfig.frontendUrl);
  });

  // ---- Session lifecycle --------------------------------------------------

  app.post("/auth/refresh", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) {
      return reply.code(401).send({ detail: "Not authenticated" });
    }

    const record = await authSessionsRepo.getByRefreshHash(db, hashRefreshToken(token));
    if (!record) {
      clearAuthCookies(reply);
      return reply.code(401).send({ detail: "Not authenticated" });
    }

    // A token that was already rotated away is being replayed — either the
    // holder raced themselves, or it leaked. Assume the worst and drop every
    // session for the user rather than silently issuing a fresh one.
    if (record.revokedAt !== null) {
      await authSessionsRepo.revokeAllForUser(db, record.userId);
      clearAuthCookies(reply);
      return reply.code(401).send({ detail: "Session revoked" });
    }

    if (!authSessionsRepo.isUsable(record)) {
      await authSessionsRepo.revoke(db, record.id);
      clearAuthCookies(reply);
      return reply.code(401).send({ detail: "Session expired" });
    }

    const user = await usersRepo.getUserById(db, record.userId);
    if (!user) {
      clearAuthCookies(reply);
      return reply.code(401).send({ detail: "Not authenticated" });
    }

    await authSessionsRepo.revoke(db, record.id);
    await issueSession(request, reply, user.id);
    return publicUser(user);
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token) {
      const record = await authSessionsRepo.getByRefreshHash(db, hashRefreshToken(token));
      if (record) await authSessionsRepo.revoke(db, record.id);
    }
    clearAuthCookies(reply);
    return { ok: true };
  });

  // ---- Account ------------------------------------------------------------

  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    const linked = await oauthRepo.listForUser(db, request.user!.id);
    return {
      ...publicUser(request.user!),
      has_password: request.user!.passwordHash !== null,
      linked_providers: linked.map((a) => a.provider),
    };
  });

  app.patch("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = patchMeBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const user = request.user!;
    const { display_name, email } = parsed.data;

    if (email && email.toLowerCase() !== user.email) {
      const clash = await usersRepo.getUserByEmail(db, email);
      if (clash) {
        return reply.code(409).send({ detail: "An account with that email already exists" });
      }
    }

    const updated = await usersRepo.updateUser(db, user.id, {
      ...(display_name === undefined ? {} : { displayName: display_name }),
      // A changed address is unproven until re-verified. Verification only gates
      // the autonomous-ordering stretch goal (PRD §5.11), so this does not lock
      // the user out of anything they can do today.
      ...(email && email.toLowerCase() !== user.email ? { email, emailVerified: false } : {}),
    });

    return publicUser(updated);
  });

  app.post("/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = changePasswordBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const user = request.user!;
    const { current_password, new_password } = parsed.data;

    // A Google-only account has no current password to prove; the authenticated
    // cookie is the proof. This doubles as the "set a password" flow so an
    // OAuth user can gain a second way in.
    if (user.passwordHash !== null) {
      if (!current_password || !(await verifyPassword(user.passwordHash, current_password))) {
        return reply.code(401).send({ detail: "Current password is incorrect" });
      }
    }

    await usersRepo.updateUser(db, user.id, {
      passwordHash: await hashPassword(new_password),
    });

    // Log out other devices, then re-issue for this one so the caller stays in.
    await authSessionsRepo.revokeAllForUser(db, user.id);
    await issueSession(request, reply, user.id);

    return { ok: true };
  });

  app.delete("/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = deleteMeBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const user = request.user!;

    if (user.passwordHash !== null) {
      if (!parsed.data.password || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
        return reply.code(401).send({ detail: "Password is incorrect" });
      }
    } else if (parsed.data.confirm !== "DELETE") {
      // No password to re-enter, so require a typed confirmation instead of
      // letting a single request destroy the account.
      return reply.code(400).send({ detail: 'Type DELETE to confirm' });
    }

    // Soft delete, so the household keeps the name against every item this
    // person added. If they are its last admin the household is dissolved with
    // them — its inventory and records destroyed, everyone still in it re-homed
    // with their account intact (PRD §2.2.8). The repository owns that branch
    // because it has to be decided inside the transaction.
    //
    // Not announced either way: a user who skipped does not know they have a
    // household, and raising it here would introduce the concept purely to
    // alarm them.
    const outcome = await householdsRepo.deleteAccount(db, user.id);
    clearAuthCookies(reply);
    return { ok: true, household_destroyed: outcome === "household_destroyed" };
  });
};
