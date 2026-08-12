import { Category } from "../types";
import { apiFetch } from "./client";

export async function listCategories(): Promise<Category[]> {
  const { categories } = await apiFetch<{ categories: Category[] }>("/categories");
  return categories;
}

export async function searchCategories(name: string): Promise<Category[]> {
  const { categories } = await apiFetch<{ categories: Category[] }>(
    `/categories/search?name=${encodeURIComponent(name)}`,
  );
  return categories;
}

export async function createCategory(name: string): Promise<Category> {
  return apiFetch<Category>("/categories", { method: "POST", body: { name } });
}

export async function renameCategory(id: string, name: string): Promise<Category> {
  return apiFetch<Category>(`/categories/${id}`, { method: "PATCH", body: { name } });
}

export async function deleteCategory(id: string): Promise<void> {
  await apiFetch<void>(`/categories/${id}`, { method: "DELETE" });
}
