import { defineConfig } from '@playwright/test';
import { apiEnv, PORTS, URLS, webEnv } from './support/env.mjs';

/**
 * End-to-end tests drive the real web app in Microsoft Edge against the real API and a separate database.
 * Supabase and Stripe are local stand-ins (support/fake-services.mjs): nothing here touches a real account.
 * Run: `pnpm --filter @repo/e2e e2e`
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1, // tests share one database and the stores they create
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: URLS.web,
    // Locally: the Edge that ships with Windows (no download). In CI: Chromium installed by `playwright install`.
    ...(process.env.CI ? {} : { channel: 'msedge' as const }),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'node support/fake-services.mjs', url: `${URLS.supabase}/auth/v1/.well-known/jwks.json`, reuseExistingServer: false, timeout: 30_000 },
    {
      // Own output folder, so it never collides with a running dev server's `dist`.
      command: 'corepack pnpm exec tsc -p tsconfig.build.json --outDir dist-e2e && node dist-e2e/main.js',
      cwd: '../apps/api',
      env: apiEnv(),
      url: `${URLS.api}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
    {
      command: `corepack pnpm exec next dev --port ${PORTS.web}`,
      cwd: '../apps/web',
      env: webEnv(),
      url: URLS.web,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
