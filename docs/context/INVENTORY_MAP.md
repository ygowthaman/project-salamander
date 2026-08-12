# Inventory — map

Pointers only; the linked file is the answer.

## Server

| | |
|---|---|
| Tables | [`db/schema/inventory.ts`](../../node-server/src/db/schema/inventory.ts) → `inventoryItems`, `InventoryItem` |
| Column helpers | [`db/schema/common.ts`](../../node-server/src/db/schema/common.ts) |
| Barrel | [`db/schema/index.ts`](../../node-server/src/db/schema/index.ts) |
| Migrations | [`node-server/drizzle/`](../../node-server/drizzle/) — regenerate, never hand-edit |
| Migration runner | [`db/migrate.ts`](../../node-server/src/db/migrate.ts), [`db/reset-migrations.ts`](../../node-server/src/db/reset-migrations.ts) |
| Repository | [`db/repositories/inventoryItems.ts`](../../node-server/src/db/repositories/inventoryItems.ts) → `listItemsWithCategory`, `createItem`, `updateItem`, `deleteItem`, `applyStockChange`, `visibleTo` |
| Service | [`services/inventory.ts`](../../node-server/src/services/inventory.ts) → `interpretSentence`, `Interpreted` |
| Domain schema | [`domain/inventory.ts`](../../node-server/src/domain/inventory.ts) → `inventoryItem` |
| Agent | [`agents/inventory.ts`](../../node-server/src/agents/inventory.ts) → `interpretInventory`, `interpretation` |
| Model client | [`agents/client.ts`](../../node-server/src/agents/client.ts) |
| Routes | [`api/inventory.ts`](../../node-server/src/api/inventory.ts) → `inventoryRoutes`, `GroupedItemsResponse`, registered in [`app.ts`](../../node-server/src/app.ts) |

## Frontend

| | |
|---|---|
| Client | [`api/inventory.ts`](../../frontend/src/api/inventory.ts) → `getInventoryGroupedByCategory`, `interpretInventoryText` |
| Transport | [`api/client.ts`](../../frontend/src/api/client.ts) → `apiFetch` |
| Types | [`types/index.ts`](../../frontend/src/types/index.ts) → `InventoryItem`, `InventoryCategoryGroup`, `InventoryGrouped`, `ItemAuthor` |
| Components | [`components/inventory/InventoryPage.tsx`](../../frontend/src/components/inventory/InventoryPage.tsx), [`InventoryItemCard.tsx`](../../frontend/src/components/inventory/InventoryItemCard.tsx) |
| Styles | [`InventoryPage.module.css`](../../frontend/src/components/inventory/InventoryPage.module.css), [`InventoryItemCard.module.css`](../../frontend/src/components/inventory/InventoryItemCard.module.css) |
| Mount | [`components/home/views.tsx`](../../frontend/src/components/home/views.tsx) |
| Mocks | [`api/mocks/inventory.groupedByCategory.json`](../../frontend/src/api/mocks/inventory.groupedByCategory.json) |

## Tests

| | |
|---|---|
| Probe | [`test/interpretation-probe.ts`](../../node-server/test/interpretation-probe.ts) |
| Model connection | [`test/agent-connection.ts`](../../node-server/test/agent-connection.ts) |

## Neighbours

| | |
|---|---|
| Categories | [`CATEGORIES_MAP.md`](CATEGORIES_MAP.md) |
| Household scoping | [`HOUSEHOLD_MAP.md`](HOUSEHOLD_MAP.md) |
| Actor | [`auth/plugin.ts`](../../node-server/src/auth/plugin.ts), [`db/schema/auth.ts`](../../node-server/src/db/schema/auth.ts) |
| Mandates | [`db/schema/mandates.ts`](../../node-server/src/db/schema/mandates.ts) |

## Docs

| | |
|---|---|
| Product | [`docs/PRD.md`](../PRD.md) |
| System | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Conflicts | [`docs/context/INVENTORY_CONFLICTS.md`](INVENTORY_CONFLICTS.md) |

## Grep seeds

`inventory_items` · `inventoryItems` · `inventoryRoutes` · `interpretInventory` · `/inventory`
