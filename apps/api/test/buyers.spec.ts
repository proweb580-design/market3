import { productInputSchema } from '@repo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, TEST_DB, type TestCtx, type TestUser } from './helpers.js';

const product = (slug: string, status: 'ACTIVE' | 'DRAFT' = 'ACTIVE') =>
  productInputSchema.parse({ slug, title: slug, status, options: [], variants: [{ options: {}, priceMinor: 1000, stock: 5 }] });

describe.skipIf(!TEST_DB)('buyer account: my orders, claiming, wishlist', () => {
  let t: TestCtx;
  let seller: TestUser;
  let store: { id: string; slug: string };
  let n = 100;

  const order = (data: { userId?: string | null; contactEmail?: string | null; organizationId?: string }) =>
    t.db.order.create({
      data: { organizationId: data.organizationId ?? store.id, number: n++, source: 'WEB', currency: 'USD', subtotalMinor: 1000n, totalMinor: 1000n, userId: data.userId ?? null, contactEmail: data.contactEmail ?? null, items: { create: { productTitle: 'Thing', variantTitle: 'M', unitPriceMinor: 1000n, quantity: 1, totalMinor: 1000n } } },
    });

  beforeAll(async () => {
    t = await createTestApp();
    seller = await t.user('buyer-seller');
    store = await t.createOrg(seller);
    await seller.post(`/organizations/${store.id}/products`, product('shirt')).expect(201);
    await seller.post(`/organizations/${store.id}/products`, product('hat')).expect(201);
    await seller.post(`/organizations/${store.id}/products`, product('secret-draft', 'DRAFT')).expect(201);
  });
  afterAll(() => t.close());

  describe('orders', () => {
    it('lists only my orders, newest first, with the store, and pages', async () => {
      const me = await t.user('shopper');
      const other = await t.user('someone-else');
      const mine = [await order({ userId: me.id }), await order({ userId: me.id }), await order({ userId: me.id })];
      await order({ userId: other.id });

      const res = await me.get('/users/me/orders?pageSize=2').expect(200);
      expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(res.body.items.map((o: { id: string }) => o.id)).toEqual([mine[2]!.id, mine[1]!.id]);
      expect(res.body.items[0]).toMatchObject({ status: 'PENDING_PAYMENT', totalMinor: 1000, itemCount: 1, store: { slug: store.slug } });
      expect(JSON.stringify(res.body)).not.toMatch(/accessTokenHash|contactEmail|shippingAddress/);
      expect((await me.get('/users/me/orders?page=2&pageSize=2').expect(200)).body.items).toHaveLength(1);
      await t.http().get('/api/v1/users/me/orders').expect(401);
    });

    it("claims guest orders placed with my verified email — and only mine", async () => {
      const me = await t.user('claimer');
      const mineGuest = await order({ contactEmail: me.email });
      const someoneElsesGuest = await order({ contactEmail: 'stranger@example.com' });
      const owned = await order({ contactEmail: me.email, userId: (await t.user('owner-of-order')).id });

      expect((await me.post('/users/me/orders/claim').expect(200)).body).toEqual({ claimed: 1 });
      expect((await t.db.order.findUniqueOrThrow({ where: { id: mineGuest.id } })).userId).toBe(me.id);
      expect((await t.db.order.findUniqueOrThrow({ where: { id: someoneElsesGuest.id } })).userId).toBeNull();
      expect((await t.db.order.findUniqueOrThrow({ where: { id: owned.id } })).userId).not.toBe(me.id);
      expect((await me.post('/users/me/orders/claim').expect(200)).body).toEqual({ claimed: 0 }); // idempotent
      expect(await t.db.auditLog.count({ where: { action: 'order.claimed', entityId: me.id } })).toBe(1);
      expect((await me.get('/users/me/orders').expect(200)).body.total).toBe(1);
    });

    it('a signed-in buyer can open a claimed order without its token', async () => {
      const me = await t.user('opener');
      const o = await order({ userId: me.id });
      await me.get(`/storefront/${store.slug}/orders/${o.id}`).expect(200);
      const stranger = await t.user('not-the-buyer');
      await stranger.get(`/storefront/${store.slug}/orders/${o.id}`).expect(404);
    });
  });

  describe('wishlist', () => {
    const base = () => `/storefront/${store.slug}/wishlist`;

    it('adds, lists, removes — idempotently, per buyer', async () => {
      const me = await t.user('wisher');
      const other = await t.user('other-wisher');
      expect((await me.get(base()).expect(200)).body).toEqual({ slugs: [] });
      expect((await me.put(`${base()}/shirt`).expect(200)).body).toEqual({ slugs: ['shirt'] });
      expect((await me.put(`${base()}/shirt`).expect(200)).body).toEqual({ slugs: ['shirt'] });
      expect((await me.put(`${base()}/hat`).expect(200)).body).toEqual({ slugs: ['shirt', 'hat'] });
      expect((await other.get(base()).expect(200)).body).toEqual({ slugs: [] });
      expect((await me.del(`${base()}/shirt`).expect(200)).body).toEqual({ slugs: ['hat'] });
      expect((await me.del(`${base()}/shirt`).expect(200)).body).toEqual({ slugs: ['hat'] });
    });

    it('rejects drafts, unknown products and stores, bad slugs, and anonymous callers', async () => {
      const me = await t.user('strict-wisher');
      await me.put(`${base()}/secret-draft`).expect(404);
      await me.put(`${base()}/no-such-product`).expect(404);
      await me.put(`${base()}/Not A Slug`).expect(400);
      await me.put('/storefront/no-such-store/wishlist/shirt').expect(404);
      await t.http().get(`/api/v1${base()}`).expect(401);
      await t.http().put(`/api/v1${base()}/shirt`).expect(401);
    });

    it("a product hidden later disappears from the list, and another store's product can't be added", async () => {
      const me = await t.user('hider');
      await me.put(`${base()}/hat`).expect(200);
      await t.db.product.updateMany({ where: { organizationId: store.id, slug: 'hat' }, data: { status: 'ARCHIVED' } });
      expect((await me.get(base()).expect(200)).body).toEqual({ slugs: [] });
      const rival = await t.user('rival-seller2');
      const rivalOrg = await t.createOrg(rival);
      await rival.post(`/organizations/${rivalOrg.id}/products`, product('their-shirt')).expect(201);
      await me.put(`${base()}/their-shirt`).expect(404);
    });

    it('caps the list at 200 items per store', async () => {
      const me = await t.user('hoarder');
      await seller.post(`/organizations/${store.id}/products`, product('one-more')).expect(201);
      const filler = await t.db.product.createManyAndReturn({ data: Array.from({ length: 200 }, (_, i) => ({ organizationId: store.id, slug: `fill-${i}`, title: 'f', status: 'ACTIVE' as const })), select: { id: true } });
      await t.db.wishlistItem.createMany({ data: filler.map((p) => ({ userId: me.id, productId: p.id, organizationId: store.id })) });
      await me.put(`${base()}/one-more`).expect(409);
    });
  });
});
