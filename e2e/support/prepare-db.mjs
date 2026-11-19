// Creates a clean platform_e2e database (local Postgres only), applies the real migrations and seeds it.
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { apiEnv, e2eDatabaseUrl } from './env.mjs';

const target = new URL(e2eDatabaseUrl());
const name = target.pathname.slice(1);
const admin = new URL(target);
admin.pathname = '/postgres';

// A brand-new database every run (Prisma keeps its migration history outside the `app` schema, so dropping only
// the schema would leave it believing the migrations are still applied).
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  await client.query(`drop database if exists "${name}" with (force)`);
  await client.query(`create database "${name}"`);
} finally {
  await client.end();
}

const apiDir = resolve(import.meta.dirname, '..', '..', 'apps', 'api');
const env = { ...process.env, ...apiEnv() };
const run = (cmd) => execSync(cmd, { cwd: apiDir, env, stdio: 'inherit' });
run('corepack pnpm exec prisma migrate deploy');
run('corepack pnpm exec tsx prisma/seed.ts');
run('corepack pnpm exec tsx prisma/seed-demo.ts');
console.log(`e2e database "${name}" ready`);
