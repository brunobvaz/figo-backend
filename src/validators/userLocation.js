import { z } from 'zod';

// Legacy location payloads remain valid for existing clients.
export const userLocationSchema = z.union([z.object({
      municipalityCode: z.string().regex(/^\d{4}$/),
      parishCode: z.string().regex(/^\d{4}[A-Z0-9]{2}$/)
    }).strict(), z.object({
      city: z.string().trim().min(2).max(100),
      postalCode: z.string().trim().regex(/^\d{4}-\d{3}$/, 'Código postal inválido.')
    }).strict()]);
