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

export const userRole = pgEnum("user_role", ["admin", "user"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().$defaultFn(randomUUID),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    emailVerified: boolean("email_verified").notNull().default(false),
    role: userRole("role").notNull().default("user"),
    skipHousehold: boolean("skip_household").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_household_id_idx").on(t.householdId),
  ],
);

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
    uniqueIndex("auth_sessions_refresh_token_hash_unique").on(t.refreshTokenHash),
    index("auth_sessions_user_id_idx").on(t.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type OauthAccount = typeof oauthAccounts.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
