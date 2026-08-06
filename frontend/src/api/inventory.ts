import { InventoryGrouped } from "../types";
import { apiFetch } from "./client";
import groupedByCategory from "./mocks/inventory.groupedByCategory.json";

const USE_MOCKS = true;

const MOCK_LATENCY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getInventoryGroupedByCategory(): Promise<InventoryGrouped> {
  if (USE_MOCKS) {
    await delay(MOCK_LATENCY_MS);
    return groupedByCategory as InventoryGrouped;
  }
  return apiFetch<InventoryGrouped>("/inventory/items/grouped");
}

export interface InterpretResult {
  summary: string;
}

export async function interpretInventoryText(text: string): Promise<InterpretResult> {
  if (USE_MOCKS) {
    await delay(MOCK_LATENCY_MS);
    return { summary: `Interpreted: "${text}"` };
  }
  return apiFetch<InterpretResult>("/inventory/interpret", { method: "POST", body: { text } });
}
