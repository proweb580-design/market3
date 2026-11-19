import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    // No default on purpose: every environment must list its allowed origins explicitly.
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    SWAGGER_ENABLED: z.stringbool().default(true),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection string'),

    // Supabase Auth: the API verifies web access tokens itself (signature, issuer, audience, expiry).
    SUPABASE_URL: z.url().optional(),
    // Server-only key for Supabase Storage (signed upload URLs, deleting files). Never exposed to a browser; unset = uploads disabled.
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    SUPABASE_JWT_AUDIENCE: z.string().default('authenticated'),
    /** Only for projects still on the legacy HS256 JWT secret; asymmetric keys are verified via JWKS. */
    SUPABASE_JWT_SECRET: z.string().min(16).optional(),

    THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
    /** Set true behind a reverse proxy (Render, Fly, Vercel) so client IPs come from X-Forwarded-For. */
    TRUST_PROXY: z.stringbool().default(false),
    // Shared secret for the scheduled-job endpoints (Vercel Cron sends it as a bearer token); unset = endpoints disabled.
    CRON_SECRET: z.string().min(16).optional(),
    INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),

    // Stripe (payments). Absent → billing works for Free/trials/admin grants, paid checkout answers 503.
    STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_/, 'must be a Stripe secret/restricted key').optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(),
    /** Points the Stripe SDK at a local stand-in (end-to-end tests only). Refused in production. */
    STRIPE_API_BASE_URL: z.url().optional(),
    /** Where Stripe Checkout sends the buyer back (the web app). */
    PUBLIC_WEB_URL: z.url().default('http://localhost:3000'),

    // Telegram Mini App.
    /** Platform bot (from @BotFather): opens any store. Brands may connect their own bot instead. Server-only. */
    TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'must look like 123456:ABC… from @BotFather').optional(),
    /** initData older than this is refused (Telegram signs it when the Mini App opens). */
    TELEGRAM_INITDATA_MAX_AGE_SEC: z.coerce.number().int().min(30).max(86_400).default(600),
    /** HTTPS address of the Mini App (apps/mini-app) — Telegram only opens HTTPS web apps. */
    PUBLIC_MINI_APP_URL: z.url().default('http://localhost:3001'),
    /** Public HTTPS address of this API — needed to register bot webhooks. */
    PUBLIC_API_URL: z.url().optional(),
    /** Signs our own session tokens (Telegram sign-in). 32+ random characters. */
    JWT_SECRET: z.string().min(32).optional(),
    /** AES-256 key (32 bytes, base64) that encrypts brands' bot tokens at rest. */
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded')
      .optional(),
  })
  .superRefine((env, ctx) => {
    // Safety net: live keys only in production, so a dev machine can never move real money.
    if (env.STRIPE_SECRET_KEY && /_live_/.test(env.STRIPE_SECRET_KEY) && env.NODE_ENV !== 'production') {
      ctx.addIssue({ code: 'custom', path: ['STRIPE_SECRET_KEY'], message: 'live keys are only allowed with NODE_ENV=production' });
    }
    if (env.STRIPE_API_BASE_URL && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', path: ['STRIPE_API_BASE_URL'], message: 'not allowed in production' });
    }
    if (env.NODE_ENV !== 'test' && !env.SUPABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'required outside tests' });
    }
  });

export type Env = z.infer<typeof envSchema>;
export const ENV = Symbol('ENV');

export function parseEnv(source: Record<string, string | undefined>): Env {
  // `KEY=` left blank in .env means "not set", not "set to an empty string".
  const result = envSchema.safeParse(Object.fromEntries(Object.entries(source).filter(([, v]) => v !== '')));
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
