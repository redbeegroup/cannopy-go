import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),
  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  /**
   * How one-time sign-in codes reach the phone. `log` writes the code to the
   * API log (fine for UAT: read it in Portainer); `webhook` POSTs
   * `{ to, text }` to SMS_WEBHOOK_URL so any gateway (an n8n flow, a local
   * SMS provider) can deliver it. See apps/api/src/services/sms.ts.
   */
  SMS_PROVIDER: z.enum(['log', 'webhook']).default('log'),
  SMS_WEBHOOK_URL: z.string().url().optional(),
  SMS_WEBHOOK_TOKEN: z.string().optional(),
  /**
   * When set, every sign-in code equals this value and no SMS is sent. For
   * testing on a phone against UAT without reading logs. Never set it on a
   * host with real data; the API logs a warning at start when it is on.
   */
  AUTH_DEV_CODE: z
    .string()
    .regex(/^\d{6}$/, 'AUTH_DEV_CODE must be 6 digits')
    .optional(),
  /** How long a device stays signed in without signing in again. */
  SESSION_DAYS: z.coerce.number().int().min(1).max(3650).default(365),
});

export type Config = z.infer<typeof envSchema> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Compose files pass unset variables as empty strings; treat those as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  if (parsed.data.SMS_PROVIDER === 'webhook' && !parsed.data.SMS_WEBHOOK_URL) {
    throw new Error('Invalid environment: SMS_WEBHOOK_URL is required when SMS_PROVIDER=webhook');
  }
  const corsOrigins = parsed.data.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { ...parsed.data, corsOrigins };
}
