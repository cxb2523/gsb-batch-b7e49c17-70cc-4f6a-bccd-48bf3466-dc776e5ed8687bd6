import { z } from 'zod';
import { isIP } from 'node:net';

/**
 * Google is the supported sign-in provider. GitHub and Microsoft work in the code but are not
 * documented or tested yet (a post-launch item), so the docs and compose files name only Google.
 */
export type OAuthProvider = 'google' | 'github' | 'microsoft';

export type TrustProxyConfig = false | number | string;

function isValidIpOrCidr(entry: string): boolean {
  const trimmed = entry.trim();
  if (isIP(trimmed)) return true;
  const parts = trimmed.split('/');
  if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
    const ip = parts[0];
    const prefix = Number(parts[1]);
    const ipVersion = isIP(ip);
    if (ipVersion === 4 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) return true;
    if (ipVersion === 6 && Number.isInteger(prefix) && prefix >= 0 && prefix <= 128) return true;
  }
  return false;
}

export const trustProxySchema = z
  .preprocess(
    (val) =>
      val === undefined
        ? 'false'
        : typeof val === 'boolean' || typeof val === 'number'
          ? String(val)
          : val,
    z.string(),
  )
  .transform((val, ctx): TrustProxyConfig => {
    const trimmed = val.trim();
    if (trimmed === 'false') {
      return false;
    }
    if (/^\d+$/.test(trimmed)) {
      const hops = parseInt(trimmed, 10);
      if (hops > 0) return hops;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TRUST_PROXY hop count must be a positive integer',
      });
      return z.NEVER;
    }
    const entries = trimmed
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (entries.length > 0 && entries.every(isValidIpOrCidr)) {
      return trimmed;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "TRUST_PROXY must be 'false', a positive integer hop count, or a comma-separated list of IP addresses or CIDR ranges",
    });
    return z.NEVER;
  });

function getTrustedOrigins(config: { NODE_ENV: string; FRONTEND_URL: string }): string[] {
  if (config.NODE_ENV === 'production') {
    return [config.FRONTEND_URL];
  }

  const origins = new Set([
    config.FRONTEND_URL,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ]);

  return Array.from(origins);
}

function getOAuthProviders(config: {
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  GITHUB_CLIENT_ID?: string | undefined;
  GITHUB_CLIENT_SECRET?: string | undefined;
  MICROSOFT_CLIENT_ID?: string | undefined;
  MICROSOFT_CLIENT_SECRET?: string | undefined;
}): OAuthProvider[] {
  const providers: OAuthProvider[] = [];
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) providers.push('google');
  if (config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET) providers.push('github');
  if (config.MICROSOFT_CLIENT_ID && config.MICROSOFT_CLIENT_SECRET) providers.push('microsoft');
  return providers;
}

const booleanFromEnv = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((v) => v === 'true');

const optionalBooleanFromEnv = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

const coreFieldsSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),

  // Core Database
  DATABASE_URL: z.string('DATABASE_URL is required').min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),

  // Auth Configuration
  AUTH_SECRET: z
    .string('AUTH_SECRET is required and must be at least 32 characters long')
    .min(32, 'AUTH_SECRET is required and must be at least 32 characters long'),
  AUTH_URL: z.string().url().default('http://localhost:3000'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  // Storage / S3 Configuration
  S3_BUCKET_NAME: z.string('S3_BUCKET_NAME is required').min(1, 'S3_BUCKET_NAME is required'),
  S3_ACCESS_KEY_ID: z.string('S3_ACCESS_KEY_ID is required').min(1, 'S3_ACCESS_KEY_ID is required'),
  S3_SECRET_ACCESS_KEY: z
    .string('S3_SECRET_ACCESS_KEY is required')
    .min(1, 'S3_SECRET_ACCESS_KEY is required'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_FORCE_PATH_STYLE: optionalBooleanFromEnv,

  // Optional Analytics (Umami)
  UMAMI_WEBSITE_ID: z.string().optional(),
  UMAMI_HOST_URL: z.string().url().optional(),

  // Optional Rate Limiting
  RATE_LIMIT_ENABLED: booleanFromEnv('true'),
  RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(100),

  // Optional Signup Lockdown
  ALLOW_SIGNUPS: booleanFromEnv('true'),
  FIRST_ACCOUNT_EMAIL: z.string().email().optional(),

  // Optional Static Dir Override
  STATIC_DIR: z.string().optional(),

  // Reverse Proxy Trust Configuration
  TRUST_PROXY: trustProxySchema,

  // Instance Limits (optional positive integers; unset means unlimited)
  LIMIT_SIGNUPS_PER_IP: z.coerce.number().int().positive().optional(),
  LIMIT_SIGNUPS_WINDOW_SECONDS: z.coerce.number().int().positive().default(3600),
  LIMIT_WORKSPACES_PER_ACCOUNT: z.coerce.number().int().positive().optional(),
  LIMIT_BOARDS_PER_ACCOUNT: z.coerce.number().int().positive().optional(),
  LIMIT_STORAGE_MB_PER_ACCOUNT: z.coerce.number().int().positive().optional(),

  // Optional Operator Identity (shown on Privacy and Terms pages)
  OPERATOR_NAME: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  OPERATOR_CONTACT: z
    .string()
    .trim()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : undefined))
    .refine(
      (val) => {
        if (!val) return true;
        const isEmail = z.string().email().safeParse(val).success;
        const isHttpUrl =
          (val.startsWith('http://') || val.startsWith('https://')) &&
          z.string().url().safeParse(val).success;
        return isEmail || isHttpUrl;
      },
      { message: 'OPERATOR_CONTACT must be a valid email address or URL' },
    ),
});

const authModeFieldsSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    ENABLE_DEV_LOGIN: booleanFromEnv('false'),
    DEMO_MODE: booleanFromEnv('false'),

    // Optional OAuth Providers
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
  })
  .transform((data) => ({
    ...data,
    oauthProviders: getOAuthProviders(data),
  }))
  .refine((data) => !(data.NODE_ENV === 'production' && data.ENABLE_DEV_LOGIN), {
    message: 'ENABLE_DEV_LOGIN cannot be enabled in production mode',
    path: ['ENABLE_DEV_LOGIN'],
  })
  .refine((data) => !(data.DEMO_MODE && data.ENABLE_DEV_LOGIN), {
    message: 'DEMO_MODE cannot be enabled together with ENABLE_DEV_LOGIN',
    path: ['DEMO_MODE'],
  })
  .refine(
    (data) => data.NODE_ENV !== 'production' || data.DEMO_MODE || data.oauthProviders.length > 0,
    {
      message:
        'Production mode requires a configured sign-in provider (Google: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) or DEMO_MODE=true.',
      path: ['GOOGLE_CLIENT_ID'],
    },
  );

export const envSchema = z
  .intersection(coreFieldsSchema, authModeFieldsSchema)
  .refine((data) => !(data.DEMO_MODE && data.FIRST_ACCOUNT_EMAIL), {
    message: 'FIRST_ACCOUNT_EMAIL cannot be enabled together with DEMO_MODE',
    path: ['FIRST_ACCOUNT_EMAIL'],
  })
  .transform((data) => ({
    ...data,
    trustedOrigins: getTrustedOrigins(data),
  }));

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(rawEnv: NodeJS.ProcessEnv = process.env): EnvConfig {
  // Compose files pass unset variables through as empty strings; an empty value means "not set".
  // They are removed from the process environment as well as from what is validated: Nest hands
  // this function a copy, and its ConfigService falls back to the process environment for any key
  // the schema left undefined.
  for (const [key, value] of Object.entries(rawEnv)) {
    if (value === '') {
      delete rawEnv[key];
      delete process.env[key];
    }
  }
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const formattedErrors = result.error.issues
      .map((issue) => `  - [${issue.path.join('.') || 'CONFIG'}]: ${issue.message}`)
      .join('\n');

    console.error('\n❌ FATAL: Environment validation failed on startup:');
    console.error(formattedErrors);
    console.error('\nPlease check your .env file or container environment variables.\n');
    throw new Error(`Environment validation failed:\n${formattedErrors}`);
  }

  return result.data;
}
