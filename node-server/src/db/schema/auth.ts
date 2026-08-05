import { randomUUID } from "node:crypto";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt } from "./common.js";
import { households } from "./households.js";

// The auth tables — identity and login state, nothing owned. Ownership moved up
// to `households.ts`, which is now the root of the dependency graph: this module
// imports it and nothing else, and every domain module imports `households.ts`
// rather than this one.
//
// These three tables are the only ones in the schema that reference `users`
// for *scope*. They are credentials — a refresh token has no household — so
// they stay keyed on `user_id`. A new *domain* table referencing `users(id)` to
// decide what a caller may see is a bug, not a variation; the one legitimate
// reason a domain table names a user is attribution, which is a nullable
// display-only column alongside `household_id` (see `inventory.ts`).

// Two roles, carried on the user rather than on a membership row, because a
// user belongs to exactly one household (PRD §2.3). If multi-household
// membership ever lands, this column moves onto the join table with it — the
// two readings ("role" and "role in this household") coincide only while the
// user has one household.
export const userRole = pgEnum("user_role", ["admin", "user"]);

// UUIDs are app-generated (crypto.randomUUID) rather than DB-side
// gen_random_uuid(), so no `pgcrypto` extension is required.
// Household auto-provisioning depends on it: the household id is known before
// either row is written, so the account and its household are one INSERT pair
// in one transaction, with no nullable-then-backfill window.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    // NOT NULL and the only path from a person to anything they can see. Every
    // user always belongs to a household (PRD §2.2) — a user who skips the
    // create form is given one silently, so there is no "no household" state
    // for readers to branch on.
    //
    // RESTRICT, never CASCADE: deleting a household that still has members is a
    // 409, not a delete that takes people with it. The one operation that does
    // destroy members — the last admin leaving (PRD §2.2.8) — deletes the user
    // rows first, in the same transaction. See repositories/households.ts.
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    // Always written lowercased — the plain unique index below is what enforces
    // the "case-insensitive" requirement, so normalisation must happen on every
    // write path. See repositories/users.ts.
    //
    // Uniqueness constrains ACTIVE accounts only (PRD §2.1). A soft delete does
    // not keep the address: it overwrites this column with an unreachable
    // `.invalid` tombstone, which releases the real address for re-registration
    // without needing a partial index or a nullable column. Registering again
    // with a released address produces a new, unrelated account.
    email: text("email").notNull(),
    // Null for accounts created via Google that never set a password. `/auth/login`
    // must treat null as "this account has no password credential" rather than as
    // a failed comparison, or it leaks which accounts are OAuth-only.
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    emailVerified: boolean("email_verified").notNull().default(false),
    // `admin` of their own household only — every role check is "admin of THIS
    // household", never "is an admin" (PRD §2.3.1). Defaulted to the lesser
    // role so a call site that forgets cannot mint an administrator; every
    // insert path states it explicitly anyway.
    role: userRole("role").notNull().default("user"),
    // Whether the household was silently provisioned (true) or deliberately
    // created/joined (false) — PRD §2.2.3. The *data* is identical either way;
    // this records the user's understanding, and it is what lets the UI hide
    // household features from someone who does not know they have one.
    //
    // NOT a "was the form shown" flag: a user who skipped and a user who was
    // never asked both sit at true, so the form is triggered by account
    // creation, not by reading this.
    skipHousehold: boolean("skip_household").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    // Soft delete (PRD §2.2.8), irreversible and with no recovery path. The row
    // survives for exactly one reason: inventory attribution. Someone still in
    // the household must be able to see who put an item on the list, so
    // hard-deleting the person would destroy or orphan that history for
    // everyone else. What survives is a name, not an account in any suspended
    // state — credentials, sessions and the email address are all destroyed.
    //
    // Every lookup that could sign someone in must exclude these rows; see
    // repositories/users.ts, which filters them for you.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_household_id_idx").on(t.householdId),
  ],
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
export type UserRole = (typeof userRole.enumValues)[number];
export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
