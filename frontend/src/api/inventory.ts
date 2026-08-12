import { Interpretation, InventoryGrouped } from "../types";
import { apiFetch } from "./client";

export async function getInventoryGroupedByCategory(): Promise<InventoryGrouped> {
  return apiFetch<InventoryGrouped>("/inventory/items/grouped");
}

export async function interpretInventoryText(text: string): Promise<Interpretation> {
  return apiFetch<Interpretation>("/inventory/interpret", { method: "POST", body: { text } });
}
