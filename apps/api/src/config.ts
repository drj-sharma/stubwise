import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined)),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
});

export type Config = z.infer<typeof envSchema>;

/** Reads and validates configuration once at start-up; a bad value stops the process with a clear message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.DATABASE_URL) {
    throw new Error('Invalid configuration: DATABASE_URL is required in production');
  }
  return parsed.data;
}
