import 'dotenv/config';
import { z } from 'zod';

const durationPattern = /^\d+(ms|s|m|h|d)$/;
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  EMAIL_FROM: z.string().trim().min(1).optional(),
  PASSWORD_RESET_URL: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  }, 'Usa um URL HTTPS sem credenciais ou fragmento.').default('https://links.figo-app.com/reset-password'),
  PASSWORD_RESET_SEND_IN_DEVELOPMENT: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
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
  BACKOFFICE_ORIGIN: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  JSON_BODY_LIMIT: z.string().default('20kb'),
  GLOBAL_RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(900000),
  GLOBAL_RATE_LIMIT_MAX: z.coerce.number().positive().default(1500),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().positive().default(10),
  REFRESH_RATE_LIMIT_MAX: z.coerce.number().positive().default(30),
  VERIFICATION_RATE_LIMIT_MAX: z.coerce.number().positive().default(10),
  FORGOT_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().positive().default(5),
  PASSWORD_RESET_EXPIRES_IN_MINUTES: z.coerce.number().positive().default(30),
  EMAIL_VERIFICATION_EXPIRES_IN_MINUTES: z.coerce.number().positive().default(1440),
  EMAIL_OTP_SECRET: z.string().min(32),
  EMAIL_OTP_EXPIRES_IN_MINUTES: z.coerce.number().positive().default(10),
  EMAIL_OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  EMAIL_OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  APP_URL: z.string().url().default('http://localhost:8081')
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === 'production' || (value.NODE_ENV === 'development' && value.PASSWORD_RESET_SEND_IN_DEVELOPMENT)) {
    for (const field of ['RESEND_API_KEY', 'EMAIL_FROM']) {
      if (!value[field]) ctx.addIssue({ code: 'custom', path: [field], message: 'Obrigatório em bench/produção ou para envio de recuperação em desenvolvimento.' });
    }
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
  throw new Error(`Configuração de ambiente inválida: ${details}`);
}

export const env = parsed.data;
