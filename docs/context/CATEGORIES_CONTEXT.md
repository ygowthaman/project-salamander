# Categories — context

Pointers only; the linked file is the answer.

## Server

| | |
|---|---|
| Tables | [`db/schema/categories.ts`](../../node-server/src/db/schema/categories.ts) |
| Barrel | [`db/schema/index.ts`](../../node-server/src/db/schema/index.ts) |
| Migrations | [`node-server/drizzle/`](../../node-server/drizzle/) — regenerate, never hand-edit |
| Repository | [`db/repositories/categories.ts`](../../node-server/src/db/repositories/categories.ts) |
| Inventory repository | [`db/repositories/inventoryItems.ts`](../../node-server/src/db/repositories/inventoryItems.ts) |
| Service | [`services/categories.ts`](../../node-server/src/services/categories.ts) |
| Routes | [`api/categories.ts`](../../node-server/src/api/categories.ts), registered in [`app.ts`](../../node-server/src/app.ts) |
| Agent | [`agents/category.ts`](../../node-server/src/agents/category.ts) |
| Model client | [`agents/client.ts`](../../node-server/src/agents/client.ts) |
| Consumers | [`services/inventory.ts`](../../node-server/src/services/inventory.ts), [`api/inventory.ts`](../../node-server/src/api/inventory.ts) |

## Frontend

| | |
|---|---|
| Client | [`api/categories.ts`](../../frontend/src/api/categories.ts) |
| Transport | [`api/client.ts`](../../frontend/src/api/client.ts) |
| Types | [`types/index.ts`](../../frontend/src/types/index.ts) |
| Component | [`components/categories/CategoriesSection.tsx`](../../frontend/src/components/categories/CategoriesSection.tsx) |
| Mount | [`components/household/HouseholdPage.tsx`](../../frontend/src/components/household/HouseholdPage.tsx) |

## Tests

| | |
|---|---|
| Agent probe | [`test/interpretation-probe.ts`](../../node-server/test/interpretation-probe.ts) |
| Scripts | [`node-server/package.json`](../../node-server/package.json) |

## Neighbours

| | |
|---|---|
| Inventory | [`INVENTORY_CONTEXT.md`](INVENTORY_CONTEXT.md) |
| Household | [`HOUSEHOLD_CONTEXT.md`](HOUSEHOLD_CONTEXT.md) |
| Actor | [`auth/plugin.ts`](../../node-server/src/auth/plugin.ts) |

## Docs

| | |
|---|---|
| Product | [`docs/PRD.md`](../PRD.md) |
| System | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) |
