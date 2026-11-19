/**
 * DEVELOPMENT ONLY: creates the "ashen" demo store (the one the storefront's demo catalogue renders),
 * so the Mini App can sign in against it. Refuses to run with NODE_ENV=production. Safe to re-run.
 *   pnpm --filter @repo/api db:seed-demo
 */
import { loadEnv } from '../src/config/load-env.js';
import { createPrismaClient } from '../src/infra/prisma/create-client.js';
import { addInterval } from '../src/modules/billing/period.js';
import { seedDemoCatalog } from './demo-catalog.js';

loadEnv();
if (process.env.NODE_ENV === 'production') throw new Error('seed-demo is for development only');
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DIRECT_URL or DATABASE_URL must be set');
const db = createPrismaClient(url);

try {
  const org = await db.organization.upsert({ where: { slug: 'ashen' }, update: {}, create: { slug: 'ashen', name: 'Ashen', currency: 'USD' } });

  const live = await db.subscription.findFirst({ where: { organizationId: org.id, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } } });
  if (!live) {
    // Business plan for a year, so every storefront feature (incl. the Telegram Mini App) is on.
    const plan = await db.plan.findUniqueOrThrow({ where: { code: 'BUSINESS' } });
    const now = new Date();
    const sub = await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, status: 'ACTIVE', currentPeriodStart: now, currentPeriodEnd: addInterval(now, 'YEAR') } });
    await db.subscriptionEvent.create({ data: { subscriptionId: sub.id, type: 'CREATED', toPlanId: plan.id, metadata: { demo: true } } });
  }

  // Make the SEED_SUPER_ADMIN_EMAIL user (if any) the owner, so the store shows up in their dashboard.
  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const owner = email ? await db.user.findUnique({ where: { email } }) : null;
  if (owner) {
    const role = await db.role.findFirstOrThrow({ where: { key: 'ORG_OWNER', organizationId: null } });
    await db.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: owner.id } },
      update: {},
      create: { organizationId: org.id, userId: owner.id, roleId: role.id },
    });
  }
  const catalog = await seedDemoCatalog(db, org.id);
  console.log(`Demo store "ashen" ready (${org.id}): ${catalog.products} products, ${catalog.collections} collections${owner ? `, owner ${email}` : ''}`);
} finally {
  await db.$disconnect();
}
