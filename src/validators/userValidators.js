import { z } from 'zod';
import { userLocationSchema } from './userLocation.js';

export const updateMeSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    location: userLocationSchema.optional()
  }).strict().refine((body) => Object.keys(body).length > 0, 'Indica pelo menos um campo para alterar.')
});
