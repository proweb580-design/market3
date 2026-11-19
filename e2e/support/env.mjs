import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Shared settings for the end-to-end run. Everything points at LOCAL stand-ins: a separate database, a fake
 * Supabase (sign-in + storage) and a fake Stripe. Nothing here can reach a real account or real money.
 */
export const PORTS = { web: 3100, api: 4100, supabase: 54399, stripe: 54398 };
export const URLS = {
  web: `http://localhost:${PORTS.web}`,
  api: `http://localhost:${PORTS.api}`,
  supabase: `http://localhost:${PORTS.supabase}`,
  stripe: `http://localhost:${PORTS.stripe}`,
};
export const WEBHOOK_SECRET = 'whsec_e2e_secret_for_signatures_only';
export const SUPERADMIN_EMAIL = 'admin@e2e.test';

const root = resolve(import.meta.dirname, '..', '..');

/** The local test Postgres server (from TEST_DATABASE_URL), with a database of our own named platform_e2e. */
export function e2eDatabaseUrl() {
  const file = resolve(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('TEST_DATABASE_URL is not set (local Postgres for tests)');
  const url = new URL(base);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error(`Refusing to run e2e against a non-local database host: ${url.hostname}`);
  url.pathname = '/platform_e2e';
  return url.toString();
}

/**
 * Complete environment for the API process. Every variable the API reads is set explicitly (blank = unset), so
 * nothing can leak in from the developer's real root `.env` (which holds the live Supabase/Telegram settings).
 */
export function apiEnv() {
  const db = e2eDatabaseUrl();
  return {
    NODE_ENV: 'development',
    PORT: String(PORTS.api),
    CORS_ORIGINS: URLS.web,
    SWAGGER_ENABLED: 'false',
    DATABASE_URL: db,
    DIRECT_URL: db,
    SUPABASE_URL: URLS.supabase,
    SUPABASE_JWT_AUDIENCE: 'authenticated',
    SUPABASE_JWT_SECRET: '',
    SUPABASE_SERVICE_ROLE_KEY: 'e2e-service-role-key-not-real',
    THROTTLE_LIMIT: '100000',
    TRUST_PROXY: 'false',
    CRON_SECRET: '',
    INVITATION_TTL_DAYS: '7',
    STRIPE_SECRET_KEY: 'sk_test_e2e_not_a_real_key',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_API_BASE_URL: URLS.stripe,
    PUBLIC_WEB_URL: URLS.web,
    PUBLIC_MINI_APP_URL: 'http://localhost:3101',
    PUBLIC_API_URL: '',
    TELEGRAM_BOT_TOKEN: '',
    TELEGRAM_INITDATA_MAX_AGE_SEC: '600',
    JWT_SECRET: 'e2e-jwt-secret-that-is-long-enough-for-hs256',
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    SEED_SUPER_ADMIN_EMAIL: SUPERADMIN_EMAIL,
  };
}

export function webEnv() {
  return {
    NEXT_PUBLIC_API_URL: URLS.api,
    API_URL: URLS.api,
    NEXT_PUBLIC_SUPABASE_URL: URLS.supabase,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key-not-real',
    NEXT_PUBLIC_SITE_URL: URLS.web,
    NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: 'e2e_bot',
    NEXT_PUBLIC_MINI_APP_URL: 'http://localhost:3101',
  };
}
