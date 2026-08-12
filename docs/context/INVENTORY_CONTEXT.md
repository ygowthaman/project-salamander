# Inventory — context

Pointers only; the linked file is the answer.

## Server

| | |
|---|---|
| Tables | [`db/schema/inventory.ts`](../../node-server/src/db/schema/inventory.ts) |
| Column helpers | [`db/schema/common.ts`](../../node-server/src/db/schema/common.ts) |
| Barrel | [`db/schema/index.ts`](../../node-server/src/db/schema/index.ts) |
| Migrations | [`node-server/drizzle/`](../../node-server/drizzle/) — regenerate, never hand-edit |
| Migration runner | [`db/migrate.ts`](../../node-server/src/db/migrate.ts), [`db/reset-migrations.ts`](../../node-server/src/db/reset-migrations.ts) |
| Repository | [`db/repositories/inventoryItems.ts`](../../node-server/src/db/repositories/inventoryItems.ts) |
| Service | [`services/inventory.ts`](../../node-server/src/services/inventory.ts) |
| Domain schema | [`domain/inventory.ts`](../../node-server/src/domain/inventory.ts) |
| Agent | [`agents/inventory.ts`](../../node-server/src/agents/inventory.ts) |
| Model client | [`agents/client.ts`](../../node-server/src/agents/client.ts) |
| Routes | [`api/inventory.ts`](../../node-server/src/api/inventory.ts), registered in [`app.ts`](../../node-server/src/app.ts) |

## Frontend

| | |
|---|---|
| Client | [`api/inventory.ts`](../../frontend/src/api/inventory.ts) |
| Transport | [`api/client.ts`](../../frontend/src/api/client.ts) |
| Types | [`types/index.ts`](../../frontend/src/types/index.ts) |
| Page | [`components/inventory/InventoryPage.tsx`](../../frontend/src/components/inventory/InventoryPage.tsx) |
| Components | [`InventoryItemCard.tsx`](../../frontend/src/components/inventory/InventoryItemCard.tsx), [`InventoryItemForm.tsx`](../../frontend/src/components/inventory/InventoryItemForm.tsx), [`InventoryProposalsTable.tsx`](../../frontend/src/components/inventory/InventoryProposalsTable.tsx) |
| Styles | [`InventoryPage.module.css`](../../frontend/src/components/inventory/InventoryPage.module.css), [`InventoryItemCard.module.css`](../../frontend/src/components/inventory/InventoryItemCard.module.css) |
| Mount | [`components/home/views.tsx`](../../frontend/src/components/home/views.tsx) |

## Tests

| | |
|---|---|
| Probe | [`test/interpretation-probe.ts`](../../node-server/test/interpretation-probe.ts) |
| Model connection | [`test/agent-connection.ts`](../../node-server/test/agent-connection.ts) |
| Scripts | [`node-server/package.json`](../../node-server/package.json) |

## Neighbours

| | |
|---|---|
| Categories | [`CATEGORIES_CONTEXT.md`](CATEGORIES_CONTEXT.md) |
| Household | [`HOUSEHOLD_CONTEXT.md`](HOUSEHOLD_CONTEXT.md) |
| Actor | [`auth/plugin.ts`](../../node-server/src/auth/plugin.ts), [`db/schema/auth.ts`](../../node-server/src/db/schema/auth.ts) |
| Mandates | [`db/schema/mandates.ts`](../../node-server/src/db/schema/mandates.ts) |

## Docs

| | |
|---|---|
| Product | [`docs/PRD.md`](../PRD.md) |
| System | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Conflicts | [`INVENTORY_CONFLICTS.md`](INVENTORY_CONFLICTS.md) |
