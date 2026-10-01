import { z } from 'zod';

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_CHAT_ID: z.string().default(''),
  GLM_API_KEY: z.string().min(1),
  GLM_BASE_URL: z.string().url().default('https://api.z.ai/api/paas/v4'),
  GLM_MODEL: z.string().min(1),
  GLM_DAILY_TOKEN_LIMIT: z.coerce.number().int().default(0),
  WEB_PASSWORD_HASH: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  TZ: z.string().default('Europe/Moscow'),
  DATA_DIR: z.string().default('./data'),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // ночная рефлексия: упаковка событий в память + обогащение графа
  REFLECTOR_ENABLED: z.string().default('1').transform((v) => !['0', 'false', 'no', 'off'].includes(v.toLowerCase())),
  REFLECTOR_HOUR: z.coerce.number().int().min(0).max(23).default(4),
  REFLECTOR_MAX_EVENTS: z.coerce.number().int().min(10).max(1000).default(200),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(): AppConfig {
  try { process.loadEnvFile(); } catch { /* .env опционален */ }
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error('Некорректные переменные окружения:\n' +
      parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  return parsed.data;
}
