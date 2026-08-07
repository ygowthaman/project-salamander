import { z } from "zod";

export const inventoryItem = z.object({
    name: z.string().trim().min(1).max(200),
    category_id: z.string().uuid(),
    unit: z.string().trim().min(1).max(50),
    quantity: z.number().int().min(0),
    attributes: z.string().trim().min(1).max(500),
    is_private: z.boolean()
});