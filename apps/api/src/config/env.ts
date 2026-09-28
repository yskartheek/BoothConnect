import { z } from 'zod';

// Development-only defaults for the signing secrets, so a fresh checkout and
// the test suites run without extra setup. Production refuses them (below).
const DEV_SECRET_PREFIX = 'dev-only-';

const seconds = (fallback: number) => z.coerce.number().int().min(1).default(fallback);

// Environment variables the API needs. The template with comments is
// infra/env/.env.example. Anything missing or malformed stops the API at
// startup, so a misconfigured deployment never serves requests.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    // Comma-separated list, e.g. "http://localhost:3000,https://admin.example.org"
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    // Authentication (#29, #30)
    JWT_ACCESS_SECRET: z.string().min(1).default(`${DEV_SECRET_PREFIX}access-secret-change-me`),
    JWT_REFRESH_SECRET: z.string().min(1).default(`${DEV_SECRET_PREFIX}refresh-secret-change-me`),
    JWT_ACCESS_TTL_SECONDS: seconds(900),
    JWT_REFRESH_TTL_SECONDS: seconds(30 * 24 * 60 * 60),
    OTP_TTL_SECONDS: seconds(300),
    OTP_DEV_MODE: z.stringbool().default(false),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    OTP_REQUEST_LIMIT: z.coerce.number().int().min(1).default(3),
    OTP_REQUEST_WINDOW_SECONDS: seconds(600),

    // How long a write's response is kept for Idempotency-Key retries (#35).
    // Long enough for a phone that was offline for days to retry its queue.
    IDEMPOTENCY_TTL_SECONDS: seconds(7 * 24 * 60 * 60),

    // Object storage for roll imports (#44): MinIO locally, any S3-compatible
    // service elsewhere. Defaults match infra/docker-compose.yml.
    S3_ENDPOINT: z.url().default('http://localhost:9000'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1).default('boothconnect'),
    S3_SECRET_ACCESS_KEY: z.string().min(1).default('boothconnect-dev-secret'),
    S3_FORCE_PATH_STYLE: z.stringbool().default(true),
    S3_BUCKET_IMPORTS: z.string().min(3).default('boothconnect-imports'),
    // Largest roll PDF and ZIP an admin may upload, and how long upload URLs work.
    IMPORT_MAX_PDF_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .default(100 * 1024 * 1024),
    IMPORT_MAX_ZIP_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .default(2 * 1024 * 1024 * 1024),
    IMPORT_UPLOAD_URL_TTL_SECONDS: seconds(60 * 60),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      const value = env[key];
      if (value.length < 32 || value.startsWith(DEV_SECRET_PREFIX)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'must be a random value of at least 32 characters in production',
        });
      }
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
    if (env.S3_SECRET_ACCESS_KEY === 'boothconnect-dev-secret') {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SECRET_ACCESS_KEY'],
        message: 'must not be the development default in production',
      });
    }
    if (env.OTP_DEV_MODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_DEV_MODE'],
        message: 'must be false in production (it writes sign-in codes to the log)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n` +
        'Copy infra/env/.env.example to .env in the repository root and fill in the values.',
    );
  }
  return result.data;
}
