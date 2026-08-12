import {
  Interpretation,
  InventoryGrouped,
  InventoryItem,
  InventoryItemPatch,
  NewInventoryItem,
} from "../types";
import { apiFetch } from "./client";

export async function getInventoryGroupedByCategory(): Promise<InventoryGrouped> {
  return apiFetch<InventoryGrouped>("/inventory/items/grouped");
}

export async function createInventoryItem(item: NewInventoryItem): Promise<InventoryItem> {
  return apiFetch<InventoryItem>("/inventory/item", { method: "POST", body: item });
}

export async function updateInventoryItem(
  id: string,
  patch: InventoryItemPatch,
): Promise<InventoryItem> {
  return apiFetch<InventoryItem>(`/inventory/items/${id}`, { method: "PATCH", body: patch });
}

export async function deleteInventoryItem(id: string): Promise<void> {
  await apiFetch<void>(`/inventory/items/${id}`, { method: "DELETE" });
}

export async function interpretInventoryText(text: string): Promise<Interpretation> {
  return apiFetch<Interpretation>("/inventory/interpret", { method: "POST", body: { text } });
}
