import { hashPassword } from "../auth/password.js";
import type { Db } from "./client.js";
import * as householdsRepo from "./repositories/households.js";

export interface SeedUserCredentials {
  email: string;
  password: string;
  displayName: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set — required to seed the initial account`);
  }
  return value;
}

export function readSeedUserCredentials(): SeedUserCredentials {
  return {
    email: requiredEnv("SEED_USER_EMAIL"),
    password: requiredEnv("SEED_USER_PASSWORD"),
    displayName: requiredEnv("SEED_USER_NAME"),
  };
}

export async function seedUser(db: Db): Promise<string> {
  const { email, password, displayName } = readSeedUserCredentials();
  const passwordHash = await hashPassword(password);
  await db.transaction((tx) =>
    householdsRepo.createUserWithHousehold(tx, {
      email,
      passwordHash,
      displayName,
      emailVerified: true,
    }),
  );
  return email;
}
