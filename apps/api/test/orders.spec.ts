import { randomUUID } from 'node:crypto';
import { productInputSchema, type ProductInput } from '@repo/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStripe } from './fake-stripe.js';
import { createTestApp, TEST_DB, type TestCtx, type TestUser } from './helpers.js';

const product = (slug: string, stock: number, priceMinor = 10000): ProductInput =>
  productInputSchema.parse({
    slug,
    title: `Item ${slug}`,
    status: 'ACTIVE',
    options: [{ name: 'Size', values: [{ value: 'M' }] }],
    variants: [{ options: { Size: 'M' }, sku: slug, priceMinor, stock }],
  });

const address = { name: 'Ada Buyer', line1: '1 Main St', city: 'Berlin', postalCode: '10115', country: 'de' };

describe.skipIf(!TEST_DB)('orders: checkout, stock, payment, access', () => {
  let t: TestCtx;
  let s: ReturnType<typeof fakeStripe>;
  let owner: TestUser;
  let org: { id: string; slug: string };

  const webhook = (event: object) => {
    const { payload, header } = s.sign(event);
    return t.http().post('/api/v1/payments/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', header).send(payload);
  };
  const variantOf = async (slug: string) => t.db.productVariant.findFirstOrThrow({ where: { organizationId: org.id, product: { slug } } });
  const stockOf = async (slug: string) => (await variantOf(slug)).stock;
  const addProduct = async (slug: string, stock: number, price?: number) => {
    await owner.post(`/organizations/${org.id}/products`, product(slug, stock, price)).expect(201);
    return (await variantOf(slug)).id;
  };
  const email = () => `buyer-${randomUUID().slice(0, 8)}@example.com`;
  const body = (variantId: string, quantity = 1, extra: object = {}) => ({ lines: [{ variantId, quantity }], email: email(), shippingAddress: address, ...extra });
  const checkout = (payload: object, as?: TestUser) => {
    const req = t.http().post(`/api/v1/storefront/${org.slug}/checkout`).send(payload);
    return as ? req.set('Authorization', `Bearer ${as.token}`) : req;
  };
  const orderOf = (id: string) => t.db.order.findUniqueOrThrow({ where: { id }, include: { items: true, payments: true } });

  beforeAll(async () => {
    s = fakeStripe();
    t = await createTestApp({ PUBLIC_WEB_URL: 'https://shop.example.com', PUBLIC_MINI_APP_URL: 'https://mini.example.com' }, { paymentProvider: s.provider });
    owner = await t.user('seller');
    org = await t.createOrg(owner);
    await owner
      .put(`/organizations/${org.id}/storefront`, {
        settings: { freeShippingThresholdMinor: 20000, shippingFlatMinor: 1500, trust: [], paymentBadges: [], footer: { menu: [], help: [], socials: [] } },
        sections: {
          hero: { enabled: false, eyebrow: '', title: 'x', subtitle: '', panels: [{ type: 'art', from: '#000000', to: '#111111', alt: '' }] },
          featured: { enabled: false, title: 'x', subtitle: '', productSlugs: [] },
          grid: { enabled: false, title: 'x', collection: 'all' },
          drop: { enabled: false, eyebrow: '', title: 'x', endsAt: '2030-01-01T00:00:00Z', panel: { type: 'art', from: '#000000', to: '#111111', alt: '' } },
          collections: { enabled: false, slugs: [] },
          social: { enabled: false, handle: '', panels: [] },
        },
        testimonials: [],
        playlist: [],
        lookbook: null,
      })
      .expect(200);
  });
  afterAll(() => t.close());
  beforeEach(() => vi.clearAllMocks());

  describe('quote', () => {
    it('prices from the database: unit prices, flat shipping below the threshold, free above it', async () => {
      const cheap = await addProduct('q-cheap', 5, 5000);
      const dear = await addProduct('q-dear', 5, 25000);
      const q = (variantId: string, quantity: number) => t.http().post(`/api/v1/storefront/${org.slug}/quote`).send({ lines: [{ variantId, quantity }] }).expect(200);

      const low = (await q(cheap, 2)).body;
      expect(low).toMatchObject({ subtotalMinor: 10000, shippingMinor: 1500, totalMinor: 11500, ok: true, currency: 'USD' });
      expect(low.lines[0]).toMatchObject({ productSlug: 'q-cheap', variantTitle: 'M', unitPriceMinor: 5000, available: 5 });
      expect((await q(dear, 1)).body).toMatchObject({ subtotalMinor: 25000, shippingMinor: 0, totalMinor: 25000 });
    });

    it('flags lines that are out of stock, unknown, or from another store, without leaking anything', async () => {
      const v = await addProduct('q-few', 1);
      const other = await t.user('other-seller');
      const otherOrg = await t.createOrg(other);
      await other.post(`/organizations/${otherOrg.id}/products`, product('their-item', 5)).expect(201);
      const theirs = (await t.db.productVariant.findFirstOrThrow({ where: { organizationId: otherOrg.id } })).id;
      const res = await t
        .http()
        .post(`/api/v1/storefront/${org.slug}/quote`)
        .send({ lines: [{ variantId: v, quantity: 3 }, { variantId: theirs, quantity: 1 }, { variantId: randomUUID(), quantity: 1 }] })
        .expect(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.lines.map((l: { ok: boolean }) => l.ok)).toEqual([false, false, false]);
      expect(res.body.lines[0]).toMatchObject({ available: 1 });
      expect(JSON.stringify(res.body.lines.slice(1))).not.toContain('their-item');
    });

    it('rejects malformed carts and unknown stores', async () => {
      const v = await addProduct('q-bad', 5);
      const post = (lines: unknown) => t.http().post(`/api/v1/storefront/${org.slug}/quote`).send({ lines });
      await post([]).expect(400);
      await post([{ variantId: v, quantity: 0 }]).expect(400);
      await post([{ variantId: v, quantity: 11 }]).expect(400);
      await post([{ variantId: v, quantity: 1 }, { variantId: v, quantity: 1 }]).expect(400);
      await post([{ variantId: 'nope', quantity: 1 }]).expect(400);
      await t.http().post('/api/v1/storefront/no-such-store/quote').send({ lines: [{ variantId: v, quantity: 1 }] }).expect(404);
    });
  });

  describe('checkout', () => {
    it('creates a pending order at server prices, reserves stock and returns a hosted payment page', async () => {
      const v = await addProduct('c-basic', 5, 5000);
      const res = await checkout(body(v, 2)).expect(201);
      expect(res.body).toMatchObject({ number: expect.any(Number), checkoutUrl: expect.stringContaining('checkout.stripe.com'), token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });

      const order = await orderOf(res.body.orderId);
      expect(order).toMatchObject({ status: 'PENDING_PAYMENT', source: 'WEB', userId: null, currency: 'USD', subtotalMinor: 10000n, shippingMinor: 1500n, totalMinor: 11500n });
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({ productTitle: 'Item c-basic', variantTitle: 'M', unitPriceMinor: 5000n, quantity: 2, totalMinor: 10000n });
      expect(order.payments[0]).toMatchObject({ purpose: 'ORDER', status: 'PENDING', amountMinor: 11500n, provider: 'stripe' });
      expect(order.shippingAddress).toMatchObject({ country: 'DE' });
      expect(await stockOf('c-basic')).toBe(3);

      // The token is stored only as a hash.
      expect(order.accessTokenHash).not.toContain(res.body.token);
      // Stripe was asked for exactly the server's total and the return address is built server-side.
      const params = s.create.mock.calls[0]![0];
      expect(params.line_items![0]!.price_data!.unit_amount).toBe(11500);
      expect(params.success_url).toBe(`https://shop.example.com/s/${org.slug}/orders/${order.id}?token=${res.body.token}&result=success`);
    });

    it('rejects client-supplied prices and unknown fields', async () => {
      const v = await addProduct('c-strict', 5);
      await checkout({ ...body(v), totalMinor: 1 }).expect(400);
      await checkout({ ...body(v), lines: [{ variantId: v, quantity: 1, unitPriceMinor: 1 }] }).expect(400);
      await checkout({ ...body(v), shippingAddress: { ...address, country: 'Germany' } }).expect(400);
      await checkout({ ...body(v), email: 'not-an-email' }).expect(400);
      expect(await stockOf('c-strict')).toBe(5);
    });

    it('never oversells: parallel buyers for the last unit — exactly one wins, stock never goes negative', async () => {
      const v = await addProduct('c-race', 1);
      const results = await Promise.all(Array.from({ length: 6 }, () => checkout(body(v))));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
      expect(await stockOf('c-race')).toBe(0);
      expect(await t.db.order.count({ where: { items: { some: { variantId: v } } } })).toBe(1);
    });

    it('a multi-line order is all-or-nothing', async () => {
      const ok = await addProduct('c-aon-ok', 5);
      const scarce = await addProduct('c-aon-scarce', 1);
      const res = await checkout({ ...body(ok), lines: [{ variantId: ok, quantity: 2 }, { variantId: scarce, quantity: 2 }] }).expect(409);
      expect(res.body.message).toMatch(/out of stock/);
      expect(await stockOf('c-aon-ok')).toBe(5);
      expect(await stockOf('c-aon-scarce')).toBe(1);
    });

    it("can't buy drafts, inactive variants, or another store's variants", async () => {
      const draft = await addProduct('c-draft', 5);
      await t.db.product.updateMany({ where: { organizationId: org.id, slug: 'c-draft' }, data: { status: 'DRAFT' } });
      await checkout(body(draft)).expect(409);
      const off = await addProduct('c-off', 5);
      await t.db.productVariant.update({ where: { id: off }, data: { isActive: false } });
      await checkout(body(off)).expect(409);

      const rival = await t.user('rival-seller');
      const rivalOrg = await t.createOrg(rival);
      await rival.post(`/organizations/${rivalOrg.id}/products`, product('rival-only', 5)).expect(201);
      const theirs = (await t.db.productVariant.findFirstOrThrow({ where: { organizationId: rivalOrg.id } })).id;
      await checkout(body(theirs)).expect(409);
      expect(await t.db.productVariant.findUniqueOrThrow({ where: { id: theirs } })).toMatchObject({ stock: 5 });
    });

    it('limits unpaid orders per email', async () => {
      const v = await addProduct('c-limit', 20);
      const same = email();
      for (let i = 0; i < 3; i++) await checkout({ ...body(v), email: same }).expect(201);
      await checkout({ ...body(v), email: same }).expect(429);
      expect(await stockOf('c-limit')).toBe(17);
    });

    it('releases the stock when the payment page cannot be created', async () => {
      const v = await addProduct('c-fail', 3);
      s.create.mockRejectedValueOnce(new Error('stripe down'));
      await checkout(body(v)).expect(502);
      expect(await stockOf('c-fail')).toBe(3);
      const order = await t.db.order.findFirstOrThrow({ where: { items: { some: { variantId: v } } }, include: { payments: true } });
      expect(order.status).toBe('CANCELED');
      expect(order.payments[0]).toMatchObject({ status: 'FAILED', failureReason: 'checkout_creation_failed' });
    });

    it('ties the order to the signed-in buyer and uses the Mini App return address for Telegram', async () => {
      const buyer = await t.user('signed-buyer');
      const v = await addProduct('c-user', 5);
      const res = await checkout({ ...body(v), channel: 'telegram' }, buyer).expect(201);
      expect((await orderOf(res.body.orderId)).userId).toBe(buyer.id);
      expect(s.create.mock.calls[0]![0].success_url).toMatch(new RegExp(`^https://mini.example.com/${org.slug}/orders/`));
      expect((await orderOf(res.body.orderId)).source).toBe('TELEGRAM');
    });

    it('a bad credential is an error, not a silent guest checkout', async () => {
      const v = await addProduct('c-badtoken', 5);
      await t.http().post(`/api/v1/storefront/${org.slug}/checkout`).set('Authorization', 'Bearer garbage').send(body(v)).expect(401);
      expect(await stockOf('c-badtoken')).toBe(5);
    });

    it('is unavailable (503) without a payment provider, and takes no stock', async () => {
      const bare = await createTestApp();
      try {
        const bareOwner = await bare.user('bare');
        const bareOrg = await bare.createOrg(bareOwner);
        await bareOwner.post(`/organizations/${bareOrg.id}/products`, product('b1', 5)).expect(201);
        const variant = await bare.db.productVariant.findFirstOrThrow({ where: { organizationId: bareOrg.id } });
        await bare.http().post(`/api/v1/storefront/${bareOrg.slug}/checkout`).send(body(variant.id)).expect(503);
        expect((await bare.db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(5);
      } finally {
        await bare.close();
      }
    });
  });

  describe('payment results', () => {
    const place = async (slug: string, stock = 5) => {
      const v = await addProduct(slug, stock);
      const res = await checkout(body(v)).expect(201);
      const order = await orderOf(res.body.orderId);
      return { v, token: res.body.token as string, order, sessionId: order.payments[0]!.providerPaymentId! };
    };

    it('a paid webhook marks the order PAID once; redelivery changes nothing', async () => {
      const { order, sessionId } = await place('p-paid');
      const evt = s.pay(sessionId);
      await webhook(evt).expect(200, { received: true });
      await webhook(evt).expect(200, { received: true, duplicate: true });
      const after = await orderOf(order.id);
      expect(after).toMatchObject({ status: 'PAID' });
      expect(after.paidAt).toBeTruthy();
      expect(after.payments[0]).toMatchObject({ status: 'SUCCEEDED' });
      expect(await t.db.transaction.count({ where: { paymentId: after.payments[0]!.id, type: 'CHARGE' } })).toBe(1);
      expect(await stockOf('p-paid')).toBe(4); // sold, not returned
    });

    it('a wrong paid amount never marks the order paid', async () => {
      const { order, sessionId } = await place('p-amount');
      await webhook(s.pay(sessionId, { amount_total: 100 })).expect(200);
      const after = await orderOf(order.id);
      expect(after.status).toBe('PENDING_PAYMENT');
      expect(after.payments[0]).toMatchObject({ status: 'FAILED', failureReason: 'amount_mismatch' });
    });

    it('an expired payment session cancels the order and returns the stock', async () => {
      const { order, sessionId } = await place('p-expired');
      expect(await stockOf('p-expired')).toBe(4);
      await webhook(s.event('checkout.session.expired', { ...s.sessions.get(sessionId)!, status: 'expired' })).expect(200);
      expect(await orderOf(order.id)).toMatchObject({ status: 'CANCELED' });
      expect(await stockOf('p-expired')).toBe(5);
    });

    it('money arriving after the order was canceled keeps it canceled and raises an audit flag for a refund', async () => {
      const { order, sessionId } = await place('p-late');
      await owner.post(`/organizations/${org.id}/orders/${order.id}/cancel`).expect(200);
      expect(await stockOf('p-late')).toBe(5);
      await webhook(s.pay(sessionId)).expect(200);
      expect((await orderOf(order.id)).status).toBe('CANCELED');
      expect(await t.db.auditLog.count({ where: { action: 'order.paid_after_cancel', entityId: order.id } })).toBe(1);
    });

    it('a full refund marks the order REFUNDED', async () => {
      const { order, sessionId } = await place('p-refund');
      await webhook(s.pay(sessionId)).expect(200);
      const admin = await t.user('refunder');
      await t.grantPlatformRole(admin.id, 'SUPER_ADMIN');
      const payment = (await orderOf(order.id)).payments[0]!;
      await admin.post(`/admin/payments/${payment.id}/refund`, {}).expect(201);
      expect((await orderOf(order.id)).status).toBe('REFUNDED');
    });

    it('the buyer returning before the webhook arrives is synced from the provider', async () => {
      const { order, token, sessionId } = await place('p-sync');
      s.pay(sessionId);
      const res = await t.http().get(`/api/v1/storefront/${org.slug}/orders/${order.id}?token=${token}`).expect(200);
      expect(res.body).toMatchObject({ status: 'PAID', payUrl: null });
    });
  });

  describe('order access', () => {
    it('is granted by the checkout token or by the signed-in buyer — and by nothing else', async () => {
      const buyer = await t.user('viewer');
      const v = await addProduct('a-view', 5);
      const res = await checkout(body(v), buyer).expect(201);
      const url = `/api/v1/storefront/${org.slug}/orders/${res.body.orderId}`;

      const byToken = await t.http().get(`${url}?token=${res.body.token}`).expect(200);
      expect(byToken.body).toMatchObject({ status: 'PENDING_PAYMENT', payUrl: expect.stringContaining('stripe.com'), items: [{ productTitle: 'Item a-view', quantity: 1 }] });
      expect(JSON.stringify(byToken.body)).not.toMatch(/accessTokenHash|organizationId/);
      await t.http().get(url).set('Authorization', `Bearer ${buyer.token}`).expect(200);

      await t.http().get(url).expect(404);
      await t.http().get(`${url}?token=${'A'.repeat(43)}`).expect(404);
      await t.http().get(`${url}?token=short`).expect(400);
      const stranger = await t.user('stranger');
      await t.http().get(url).set('Authorization', `Bearer ${stranger.token}`).expect(404);
      // A valid token does not open the order through another store's URL.
      const other = await t.user('other-store');
      const otherOrg = await t.createOrg(other);
      await t.http().get(`/api/v1/storefront/${otherOrg.slug}/orders/${res.body.orderId}?token=${res.body.token}`).expect(404);
    });
  });

  describe('brand order management', () => {
    it('lists, filters, fulfils paid orders and refuses invalid transitions', async () => {
      const v = await addProduct('m-flow', 9);
      const placed = await checkout(body(v)).expect(201);
      const order = await orderOf(placed.body.orderId);

      const listed = await owner.get(`/organizations/${org.id}/orders?q=${order.number}`).expect(200);
      expect(listed.body.items.map((o: { id: string }) => o.id)).toEqual([order.id]);
      expect(listed.body.items[0]).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' });
      await owner.get(`/organizations/${org.id}/orders?sort=accessTokenHash`).expect(400);

      await owner.post(`/organizations/${org.id}/orders/${order.id}/fulfill`).expect(409); // not paid yet
      await webhook(s.pay(order.payments[0]!.providerPaymentId!)).expect(200);
      expect((await owner.post(`/organizations/${org.id}/orders/${order.id}/fulfill`).expect(200)).body.status).toBe('FULFILLED');
      await owner.post(`/organizations/${org.id}/orders/${order.id}/fulfill`).expect(409);
      await owner.post(`/organizations/${org.id}/orders/${order.id}/cancel`).expect(409); // paid orders are refunded, not canceled
      expect(await t.db.auditLog.count({ where: { entityId: order.id, action: { in: ['order.created', 'order.paid', 'order.fulfilled'] } } })).toBe(3);
    });

    it('is isolated per organization and per permission', async () => {
      const v = await addProduct('m-iso', 5);
      const placed = await checkout(body(v)).expect(201);
      const rival = await t.user('rival-orders');
      const rivalOrg = await t.createOrg(rival);
      await rival.get(`/organizations/${org.id}/orders`).expect(404);
      await rival.get(`/organizations/${rivalOrg.id}/orders/${placed.body.orderId}`).expect(404);
      await rival.post(`/organizations/${rivalOrg.id}/orders/${placed.body.orderId}/cancel`).expect(404);

      const staff = await t.user('order-staff');
      await t.addMember(org.id, staff, 'ORG_STAFF');
      await staff.get(`/organizations/${org.id}/orders/${placed.body.orderId}`).expect(200);
      const viewer = await t.user('no-orders');
      await t.http().get(`/api/v1/organizations/${org.id}/orders`).expect(401);
      await viewer.get(`/organizations/${org.id}/orders`).expect(404);
    });
  });

  describe('expiry job', () => {
    it('releases stock of orders unpaid past the window, but first honours a payment whose webhook was lost', async () => {
      const lost = await addProduct('x-lost', 5);
      const stale = await addProduct('x-stale', 5);
      const paid = await orderOf((await checkout(body(lost)).expect(201)).body.orderId);
      const unpaid = await orderOf((await checkout(body(stale)).expect(201)).body.orderId);
      s.pay(paid.payments[0]!.providerPaymentId!); // paid at Stripe, webhook never arrived
      const old = new Date(Date.now() - 2 * 3600_000);
      await t.db.order.updateMany({ where: { id: { in: [paid.id, unpaid.id] } }, data: { createdAt: old } });

      const { OrdersService } = await import('../src/modules/orders/orders.service.js');
      const result = await t.app.get(OrdersService).expireStale();
      expect(result.canceled).toBeGreaterThanOrEqual(1);
      expect((await orderOf(paid.id)).status).toBe('PAID');
      expect(await stockOf('x-lost')).toBe(4);
      expect(await orderOf(unpaid.id)).toMatchObject({ status: 'CANCELED' });
      expect((await orderOf(unpaid.id)).payments[0]).toMatchObject({ status: 'CANCELED', failureReason: 'expired' });
      expect(await stockOf('x-stale')).toBe(5);
      // Running again is a no-op.
      await t.app.get(OrdersService).expireStale();
      expect(await stockOf('x-stale')).toBe(5);
    });
  });
});
