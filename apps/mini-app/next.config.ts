import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// One project-wide .env in the repository root (apps/<app>/.env.local still wins). Already-set variables are never overridden.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// The site has no landing page: the home address opens the main store's catalogue right away.
const DEFAULT_STORE = process.env.DEFAULT_STORE ?? 'ashen';

const baseHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // The order page keeps a private token in its URL: other sites only ever see our origin.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  redirects: async () => [{ source: '/', destination: `/${DEFAULT_STORE}`, permanent: false }],
  // Telegram Web shows Mini Apps inside its own page, so framing is allowed for Telegram only (not for any other site).
  headers: async () => [{ source: '/:path*', headers: [...baseHeaders, { key: 'Content-Security-Policy', value: "frame-ancestors 'self' https://*.telegram.org https://t.me" }] }],
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ['@repo/ui'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
