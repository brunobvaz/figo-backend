import 'dotenv/config';
import { z } from 'zod';

const durationPattern = /^\d+(ms|s|m|h|d)$/;
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PUSH_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().trim().min(1).default('development'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().regex(durationPattern).default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(durationPattern).default('30d'),
  CORS_ORIGIN: z.string().default('http://localhost:8081'),
  JSON_BODY_LIMIT: z.string().default('20kb'),
  GLOBAL_RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(900000),
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().positive().default(200),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().positive().default(10),
  FORGOT_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().positive().default(5),
  PASSWORD_RESET_EXPIRES_IN_MINUTES: z.coerce.number().positive().default(30),
  EMAIL_VERIFICATION_EXPIRES_IN_MINUTES: z.coerce.number().positive().default(1440),
  EMAIL_OTP_SECRET: z.string().min(32),
  EMAIL_OTP_EXPIRES_IN_MINUTES: z.coerce.number().positive().default(10),
  EMAIL_OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  APP_URL: z.string().url().default('http://localhost:8081')
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
  throw new Error(`Configuração de ambiente inválida: ${details}`);
}

export const env = parsed.data;
