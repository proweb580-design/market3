import { randomUUID } from 'node:crypto';
import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { SYSTEM_ROLE_DEFINITIONS } from '@repo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS_META } from '../src/common/decorators.js';
import { createTestApp, TEST_DB, type TestCtx, type TestUser } from './helpers.js';

interface Route {
  name: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  required: string[];
}

const METHODS = { [RequestMethod.GET]: 'get', [RequestMethod.POST]: 'post', [RequestMethod.PUT]: 'put', [RequestMethod.PATCH]: 'patch', [RequestMethod.DELETE]: 'delete' } as const;
const first = (v: unknown) => (Array.isArray(v) ? (v[0] as string) : ((v as string | undefined) ?? ''));
const join = (...parts: string[]) => '/' + parts.flatMap((p) => p.split('/')).filter(Boolean).join('/');

/** Every route of every controller, read from the decorators (the same source Nest routes from). */
function routesOf(ctx: TestCtx): Route[] {
  const discovery = ctx.app.get(DiscoveryService);
  const reflector = ctx.app.get(Reflector);
  const out: Route[] = [];
  for (const wrapper of discovery.getControllers()) {
    const cls = wrapper.metatype!;
    const proto = cls.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const sub = Reflect.getMetadata('path', handler) as unknown;
      const method = METHODS[Reflect.getMetadata('method', handler) as keyof typeof METHODS];
      if (sub === undefined || !method) continue;
      out.push({
        name: `${cls.name}.${name}`,
        method,
        path: join('api/v1', first(Reflect.getMetadata('path', cls)), first(sub)),
        required: reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_META, [handler as () => void, cls]) ?? [],
      });
    }
  }
  return out;
}

describe.skipIf(!TEST_DB)('security sweep over every organization route', () => {
  let t: TestCtx;
  let owner: TestUser;
  let outsider: TestUser;
  let staff: TestUser;
  let org: { id: string };
  let routes: Route[];

  /** Fills `:orgId` with the real store and every other `:param` with a random id. */
  const urlFor = (r: Route) => r.path.replace(':orgId', org.id).replace(/:[A-Za-z]+/g, () => randomUUID());
  const call = (u: TestUser | null, r: Route) => {
    const req = t.http()[r.method](urlFor(r));
    if (u) req.set('Authorization', `Bearer ${u.token}`);
    return ['post', 'put', 'patch'].includes(r.method) ? req.send({}) : req;
  };

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.user('sweep-owner');
    outsider = await t.user('sweep-outsider');
    staff = await t.user('sweep-staff');
    org = await t.createOrg(owner);
    await t.addMember(org.id, staff, 'ORG_STAFF');
    // `leave` really removes the caller from the store, which would turn later 403s into 404s; it has its own tests.
    routes = routesOf(t).filter((r) => r.path.includes(':orgId') && !r.path.endsWith('/leave'));
  });
  afterAll(() => t.close());

  it('finds the organization routes (guards against the sweep silently testing nothing)', () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.some((r) => r.name.startsWith('CatalogController'))).toBe(true);
    expect(routes.some((r) => r.name.startsWith('OrdersController'))).toBe(true);
  });

  it('anonymous callers get 401 on every one', async () => {
    const bad: string[] = [];
    for (const r of routes) if ((await call(null, r)).status !== 401) bad.push(`${r.method} ${r.path}`);
    expect(bad).toEqual([]);
  });

  it("a signed-in user who is not a member gets 404 on every one — the store's existence is not revealed", async () => {
    const bad: string[] = [];
    for (const r of routes) {
      const res = await call(outsider, r);
      if (res.status !== 404) bad.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(bad).toEqual([]);
  });

  it('a staff member gets 403 exactly on the routes whose permissions the staff role lacks', async () => {
    const staffKeys = new Set(SYSTEM_ROLE_DEFINITIONS.find((d) => d.key === 'ORG_STAFF')!.permissions as readonly string[]);
    const bad: string[] = [];
    for (const r of routes) {
      const res = await call(staff, r);
      const shouldBlock = r.required.some((k) => !staffKeys.has(k));
      if (shouldBlock && res.status !== 403) bad.push(`${r.method} ${r.path} should be 403, got ${res.status}`);
      if (!shouldBlock && res.status === 403 && r.required.length) bad.push(`${r.method} ${r.path} wrongly 403`);
    }
    expect(bad).toEqual([]);
  });
});

describe.skipIf(!TEST_DB)('request hardening', () => {
  let t: TestCtx;
  let owner: TestUser;
  let org: { id: string; slug: string };

  beforeAll(async () => {
    t = await createTestApp();
    owner = await t.user('hardening-owner');
    org = await t.createOrg(owner);
  });
  afterAll(() => t.close());

  it('sends security headers on API responses', async () => {
    const res = await t.http().get('/api/v1/health').expect(200);
    expect(res.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('treats SQL-looking input as plain text and refuses unknown sort fields', async () => {
    await owner.get(`/organizations/${org.id}/products?q=${encodeURIComponent("' OR 1=1; DROP TABLE app.products; --")}`).expect(200);
    await owner.get(`/organizations/${org.id}/products?sort=${encodeURIComponent('title;DROP TABLE x')}`).expect(400);
    await owner.get(`/organizations/${org.id}/orders?sort=-contactEmail`).expect(400);
    expect(await t.db.product.count()).toBeGreaterThanOrEqual(0); // the table still answers
  });

  it('rejects oversized and malformed bodies cleanly (never a 500)', async () => {
    const huge = { title: 'x'.repeat(3 * 1024 * 1024) };
    expect((await owner.post(`/organizations/${org.id}/products`, huge)).status).toBe(413);
    const broken = await t.http().post(`/api/v1/organizations/${org.id}/products`).set('Authorization', `Bearer ${owner.token}`).set('Content-Type', 'application/json').send('{"title": ');
    expect(broken.status).toBe(400);
    expect(JSON.stringify(broken.body)).not.toMatch(/SyntaxError|at .*\.js|node_modules/);
  });

  it('ignores prototype-pollution and mass-assignment attempts', async () => {
    const res = await owner.post(`/organizations/${org.id}/collections`, JSON.parse('{"slug":"c-poison","title":"C","__proto__":{"isAdmin":true},"organizationId":"00000000-0000-0000-0000-000000000000"}'));
    expect(res.status).toBe(400);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(await t.db.collection.count({ where: { slug: 'c-poison' } })).toBe(0);
    await owner.patch('/profiles/me', { role: 'SUPER_ADMIN', status: 'ACTIVE' }).expect(400);
  });

  it('does not leak stack traces or driver text in errors', async () => {
    const res = await owner.get(`/organizations/${org.id}/products/not-a-uuid`).expect(400);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|postgres|\.ts:|stack/i);
    expect(res.body).toHaveProperty('requestId');
  });
});

describe.skipIf(!TEST_DB)('abuse limits', () => {
  it('throttles anonymous spam on public endpoints (429), per client address', async () => {
    const t = await createTestApp({ THROTTLE_LIMIT: '5' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) statuses.push((await t.http().post('/api/v1/storefront/nowhere/quote').send({ lines: [{ variantId: randomUUID(), quantity: 1 }] })).status);
      expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
      expect(statuses.slice(5)).toEqual([429, 429, 429]);
    } finally {
      await t.close();
    }
  });
});
