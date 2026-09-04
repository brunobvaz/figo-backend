import { z } from 'zod';

export const updateMeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    location: z.object({ city: z.string().trim().min(2).max(100), postalCode: z.string().trim().regex(/^\d{4}-\d{3}$/) }).optional()
  }).strict().refine((body) => Object.keys(body).length > 0, 'Indica pelo menos um campo para alterar.')
});
