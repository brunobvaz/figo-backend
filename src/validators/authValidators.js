import { userLocationSchema } from './userLocation.js';
import { z } from 'zod';

const password = z.string().min(10).max(128)
  .regex(/[a-z]/, 'A password deve conter uma letra minúscula.')
  .regex(/[A-Z]/, 'A password deve conter uma letra maiúscula.')
  .regex(/\d/, 'A password deve conter um número.')
  .regex(/[^A-Za-z0-9]/, 'A password deve conter um símbolo.');

const email = z.string().trim().toLowerCase().email();
const phone = z.string().trim().regex(/^(?:(?:\+|00)351)?[29]\d{8}$/, 'Telefone português inválido.');
const roles = z.array(z.enum(['buyer', 'seller'])).min(1).transform((items) => [...new Set(items)]);

export const registerSchema = z.object({
  body: z.object({
    firstName: z.string().trim().min(2).max(60),
    lastName: z.string().trim().min(2).max(80),
    email,
    phone: phone.optional(),
    password,
    // Accepted for older clients, but ignored when assigning permissions.
    roles: roles.optional(),
    usageIntent: z.enum(['buy', 'sell', 'both']).optional(),
    location: userLocationSchema,
    confirmAdult: z.literal(true, { error: 'É necessário confirmar a maioridade.' }),
    acceptTerms: z.literal(true, { error: 'É necessário aceitar os termos.' }),
    marketingConsent: z.boolean().default(false)
  }).strict()
});

export const loginSchema = z.object({ body: z.object({ email, password: z.string().min(1).max(128) }).strict() });
export const refreshSchema = z.object({ body: z.object({ refreshToken: z.string().min(1) }).strict() });
export const logoutSchema = refreshSchema;
export const emailSchema = z.object({ body: z.object({ email }).strict() });
export const resetPasswordSchema = z.object({ body: z.object({ token: z.string().min(32), newPassword: password }).strict() });
export const changePasswordSchema = z.object({ body: z.object({ currentPassword: z.string().min(1), newPassword: password }).strict() });
export const verifyEmailSchema = z.object({ body: z.object({ challengeId: z.string().regex(/^[a-f\d]{24}$/i), code: z.string().regex(/^\d{6}$/) }).strict() });
export const resendEmailVerificationSchema = z.object({ body: z.object({ challengeId: z.string().regex(/^[a-f\d]{24}$/i) }).strict() });
