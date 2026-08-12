# Household — context

Pointers only; the linked file is the answer.

## Server

| | |
|---|---|
| Tables | [`db/schema/households.ts`](../../node-server/src/db/schema/households.ts) |
| Members | [`db/schema/auth.ts`](../../node-server/src/db/schema/auth.ts) |
| Barrel | [`db/schema/index.ts`](../../node-server/src/db/schema/index.ts) |
| Migrations | [`node-server/drizzle/`](../../node-server/drizzle/) — regenerate, never hand-edit |
| Repository | [`db/repositories/households.ts`](../../node-server/src/db/repositories/households.ts) |
| Service | [`services/households.ts`](../../node-server/src/services/households.ts) |
| Routes | [`api/households.ts`](../../node-server/src/api/households.ts), registered in [`app.ts`](../../node-server/src/app.ts) |
| Auth guard | [`auth/plugin.ts`](../../node-server/src/auth/plugin.ts) |

## Frontend

| | |
|---|---|
| Client | [`api/households.ts`](../../frontend/src/api/households.ts) |
| Transport | [`api/client.ts`](../../frontend/src/api/client.ts) |
| Types | [`types/index.ts`](../../frontend/src/types/index.ts) |
| Page | [`components/household/HouseholdPage.tsx`](../../frontend/src/components/household/HouseholdPage.tsx) |
| Setup | [`components/household/HouseholdSetupModal.tsx`](../../frontend/src/components/household/HouseholdSetupModal.tsx) |
| Settings | [`components/settings/HouseholdSettings.tsx`](../../frontend/src/components/settings/HouseholdSettings.tsx), [`HouseholdMembers.tsx`](../../frontend/src/components/settings/HouseholdMembers.tsx), [`HouseholdDangerZone.tsx`](../../frontend/src/components/settings/HouseholdDangerZone.tsx) |
| Settings shell | [`components/settings/SettingsPage.tsx`](../../frontend/src/components/settings/SettingsPage.tsx), [`SettingsPlaceholder.tsx`](../../frontend/src/components/settings/SettingsPlaceholder.tsx) |
| Mount | [`components/home/HomePage.tsx`](../../frontend/src/components/home/HomePage.tsx), [`views.tsx`](../../frontend/src/components/home/views.tsx) |
| Session | [`auth/AuthContext.tsx`](../../frontend/src/auth/AuthContext.tsx), [`auth/useAuth.ts`](../../frontend/src/auth/useAuth.ts) |

## Neighbours

| | |
|---|---|
| Categories | [`CATEGORIES_CONTEXT.md`](CATEGORIES_CONTEXT.md) |
| Inventory | [`INVENTORY_CONTEXT.md`](INVENTORY_CONTEXT.md) |
| Auth API | [`api/auth.ts`](../../node-server/src/api/auth.ts), [`frontend/api/auth.ts`](../../frontend/src/api/auth.ts) |
| Users repository | [`db/repositories/users.ts`](../../node-server/src/db/repositories/users.ts) |

## Docs

| | |
|---|---|
| Product | [`docs/PRD.md`](../PRD.md) |
| System | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) |
