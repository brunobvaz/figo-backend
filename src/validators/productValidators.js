import { z } from 'zod';

const productFields = {
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(2000),
  price: z.coerce.number().positive().max(1_000_000),
  unit: z.enum(['€/kg', '€/unidade', '€/dúzia', '€/frasco', '€/caixa']),
  category: z.enum(['Frutas', 'Legumes', 'Ovos', 'Mel', 'Laticínios', 'Padaria', 'Bebidas', 'Conservas', 'Outros']),
  location: z.string().trim().min(2).max(120),
  image: z.string().url().nullable().optional()
};

export const createProductSchema = z.object({ body: z.object(productFields).strict() });
export const updateProductSchema = z.object({ body: z.object(productFields).partial().strict().refine((body) => Object.keys(body).length > 0, 'Indica pelo menos um campo para alterar.') });
export const productIdSchema = z.object({ params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }) });
export const listProductsSchema = z.object({ query: z.object({ search: z.string().trim().max(100).optional(), category: z.string().trim().max(50).optional(), sellerId: z.string().regex(/^[a-f\d]{24}$/i).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(50) }) });
