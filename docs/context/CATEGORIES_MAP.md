# Categories — map

Pointers only; the linked file is the answer.

## Server

| | |
|---|---|
| Tables | [`db/schema/categories.ts`](../../node-server/src/db/schema/categories.ts) → `categories`, `Category`, `NewCategory` |
| Barrel | [`db/schema/index.ts`](../../node-server/src/db/schema/index.ts) |
| Migrations | [`node-server/drizzle/`](../../node-server/drizzle/) — regenerate, never hand-edit |
| Repository | [`db/repositories/categories.ts`](../../node-server/src/db/repositories/categories.ts) → `listCategories`, `getCategory`, `findCategoriesByName`, `categoryExists`, `createCategory`, `renameCategory`, `deleteCategory`, `CategoryWrite`, `CategoryDeletion` |
| Item counts | [`db/repositories/inventoryItems.ts`](../../node-server/src/db/repositories/inventoryItems.ts) → `countItemsByCategory`, `countItemsInCategory` |
| Service | [`services/categories.ts`](../../node-server/src/services/categories.ts) → `CategoryError`, `listCategories`, `getCategory`, `findCategoriesByName`, `createCategory`, `renameCategory`, `deleteCategory` |
| Routes | [`api/categories.ts`](../../node-server/src/api/categories.ts) → `categoryRoutes`, registered in [`app.ts`](../../node-server/src/app.ts) |
| Agent | [`agents/category.ts`](../../node-server/src/agents/category.ts) → `interpretCategory`, `interpretation`, `Interpretation` |
| Model client | [`agents/client.ts`](../../node-server/src/agents/client.ts) |
| Consumer | [`services/inventory.ts`](../../node-server/src/services/inventory.ts), [`api/inventory.ts`](../../node-server/src/api/inventory.ts) |

## Frontend

| | |
|---|---|
| Client | [`api/categories.ts`](../../frontend/src/api/categories.ts) → `listCategories`, `searchCategories`, `createCategory`, `renameCategory`, `deleteCategory` |
| Transport | [`api/client.ts`](../../frontend/src/api/client.ts) → `apiFetch` |
| Types | [`types/index.ts`](../../frontend/src/types/index.ts) → `Category`, `InventoryCategoryGroup` |
| Component | [`components/categories/CategoriesSection.tsx`](../../frontend/src/components/categories/CategoriesSection.tsx) |
| Mount | [`components/household/HouseholdPage.tsx`](../../frontend/src/components/household/HouseholdPage.tsx) |

## Tests

| | |
|---|---|
| Agent probe | [`test/interpretation-probe.ts`](../../node-server/test/interpretation-probe.ts) — `npm run check:interpret` |

## Neighbours

| | |
|---|---|
| Inventory | [`INVENTORY_MAP.md`](INVENTORY_MAP.md) |
| Household | [`HOUSEHOLD_MAP.md`](HOUSEHOLD_MAP.md) |
| Actor | [`auth/plugin.ts`](../../node-server/src/auth/plugin.ts) |

## Docs

| | |
|---|---|
| Product | [`docs/PRD.md`](../PRD.md) |
| System | [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) |

## Grep seeds

`categories` · `categoryId` · `categoryRoutes` · `CategoryError` · `interpretCategory` · `CategoriesSection` · `/categories`
