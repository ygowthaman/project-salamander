import { randomUUID } from "node:crypto";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`);

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
  (t) => ({
    emailUnique: uniqueIndex("users_email_unique").on(t.email),
  }),
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
  (t) => ({
    providerAccountUnique: uniqueIndex("oauth_accounts_provider_account_unique").on(
      t.provider,
      t.providerAccountId,
    ),
    userIdx: index("oauth_accounts_user_id_idx").on(t.userId),
  }),
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
  (t) => ({
    // Unique because the hash is the lookup key on every refresh.
    tokenHashUnique: uniqueIndex("auth_sessions_refresh_token_hash_unique").on(t.refreshTokenHash),
    userIdx: index("auth_sessions_user_id_idx").on(t.userId),
  }),
);

// Chat sessions. `user_id` is NOT NULL: every conversation belongs to exactly
// one account, and the pre-auth anonymous rows are dropped by the migration
// that adds this column (they have no owner to attribute them to).
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    // Backs the "list my chat sessions, newest first" query.
    userIdx: index("sessions_user_id_created_at_idx").on(t.userId, t.createdAt),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    // Declared here to match the index already created by 0000_init.sql — without
    // it, `drizzle-kit generate` would emit a DROP for an index the app depends on.
    sessionIdx: index("messages_session_id_created_at_idx").on(t.sessionId, t.createdAt),
  }),
);

export type User = typeof users.$inferSelect;
export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
