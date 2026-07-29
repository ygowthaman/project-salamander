import { randomUUID } from "node:crypto";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt } from "./common.js";

// The auth tables. This is the root of the schema's dependency graph: every
// user-owned table in the other modules points here, and this module imports
// none of them.

// UUIDs are app-generated (crypto.randomUUID), matching the previous Python
// implementation's `default=uuid.uuid4` rather than a DB-side gen_random_uuid().
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    // Always written lowercased — the plain unique index below is what enforces
    // the "case-insensitive" requirement, so normalisation must happen on every
    // write path. See repositories/users.ts.
    email: text("email").notNull(),
    // Null for accounts created via Google that never set a password. `/auth/login`
    // must treat null as "this account has no password credential" rather than as
    // a failed comparison, or it leaks which accounts are OAuth-only.
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    emailVerified: boolean("email_verified").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

// One row per (provider, external account). Keyed on the provider's stable
// subject id, never on email: a Google account's email can change, and matching
// on email would silently re-point the link at a different person.
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("oauth_accounts_provider_account_unique").on(t.provider, t.providerAccountId),
    index("oauth_accounts_user_id_idx").on(t.userId),
  ],
);

// Refresh-token store. Holds only a SHA-256 of the token so a database leak
// cannot be replayed as a login; existence of a row is what makes an auth
// session revocable (logout, "log out everywhere", password change).
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    // Unique because the hash is the lookup key on every refresh.
    uniqueIndex("auth_sessions_refresh_token_hash_unique").on(t.refreshTokenHash),
    index("auth_sessions_user_id_idx").on(t.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
