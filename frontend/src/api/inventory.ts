import { InventoryGrouped } from "../types";
import { apiFetch } from "./client";
import groupedByCategory from "./mocks/inventory.groupedByCategory.json";

/**
 * The inventory routes do not exist on the server yet, so every call in here
 * resolves from a fixture instead of hitting the network. Each function keeps
 * the real `apiFetch` line beside its mock, so switching this flag to `false`
 * once the routes land is the whole migration.
 */
const USE_MOCKS = true;

/** Enough latency for the loading state to be a real thing the UI renders. */
const MOCK_LATENCY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The inventory list, already bucketed by category — the grouping is the
 * server's job because it owns the category rows, and doing it here would mean
 * the client inventing a display order the server can't reproduce.
 *
 * Category is the only grouping there is, so the endpoint takes no dimension:
 * `unit` is free text precisely because nothing groups or totals by it.
 */
export async function getInventoryGroupedByCategory(): Promise<InventoryGrouped> {
  if (USE_MOCKS) {
    await delay(MOCK_LATENCY_MS);
    return groupedByCategory as InventoryGrouped;
  }
  return apiFetch<InventoryGrouped>("/inventory/items/grouped");
}

/** What the server sends back after interpreting and committing a sentence. */
export interface InterpretResult {
  /** Rendered by the UI as a receipt — never model prose, always server text. */
  summary: string;
}

/**
 * Send one plain sentence ("low on eggs and milk") for the model to interpret.
 * Direct commit: the server validates, writes, and answers with what it applied
 * — there is no confirm step and nothing conversational on either side.
 */
export async function interpretInventoryText(text: string): Promise<InterpretResult> {
  if (USE_MOCKS) {
    await delay(MOCK_LATENCY_MS);
    return { summary: `Interpreted: "${text}"` };
  }
  return apiFetch<InterpretResult>("/inventory/interpret", { method: "POST", body: { text } });
}
