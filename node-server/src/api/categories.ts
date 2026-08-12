import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import {
  CategoryError,
  createCategory,
  deleteCategory,
  findCategoriesByName,
  getCategory,
  listCategories,
  renameCategory,
} from "../services/categories.js";
import type { Category } from "../db/schema/index.js";

const idParams = z.object({
  id: z.string().uuid(),
});

const nameInput = z.object({
  name: z.string().trim().min(1).max(100),
});


function publicCategory(category: Category) {
  return {
    id: category.id,
    name: category.name,
    created_at: category.createdAt.toISOString(),
    updated_at: category.updatedAt.toISOString(),
  };
}

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof CategoryError) {
      return reply.code(error.status).send({ detail: error.detail });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ detail: error.message });
    }
    request.log.error({ err: error }, "category route failed");
    return reply.code(500).send({ detail: "Internal server error" });
  });

  app.get("/categories", async (request) => {
    const categories = await listCategories(request.user!);
    return { categories: categories.map(publicCategory) };
  });

  app.get("/categories/search", async (request, reply) => {
    const parsed = nameInput.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const matches = await findCategoriesByName(request.user!, parsed.data.name);
    return { categories: matches.map(publicCategory) };
  });

  app.get("/categories/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    return publicCategory(await getCategory(request.user!, parsed.data.id));
  });

  app.post("/categories", async (request, reply) => {
    const parsed = nameInput.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    const category = await createCategory(request.user!, parsed.data.name);
    return reply.code(201).send(publicCategory(category));
  });

  app.patch("/categories/:id", async (request, reply) => {
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(422).send({ detail: params.error.issues });
    }
    const parsed = nameInput.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    return publicCategory(await renameCategory(request.user!, params.data.id, parsed.data.name));
  });

  app.delete("/categories/:id", async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(422).send({ detail: parsed.error.issues });
    }
    await deleteCategory(request.user!, parsed.data.id);
    return reply.code(204).send();
  });
};
