import { z } from 'zod';

export const listPublicRecipesSchema = z.object({ query: z.object({
  category: z.string().trim().min(1).max(40).optional(),
  quick: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict() });
const recipeParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Identificador de receita inválido.') });
export const publicRecipeDetailSchema = z.object({ params: recipeParams });
export const publicRecipeImageSchema = z.object({
  params: recipeParams,
  query: z.object({ v: z.uuid().optional() }).strict()
});
