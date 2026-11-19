import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { fakeStripe, WEBHOOK_SECRET } from './fake-stripe.js';
import { addInterval } from '../src/modules/billing/period.js';
import { createTestApp, TEST_DB, type TestCtx, type TestUser } from './helpers.js';

describe.skipIf(!TEST_DB)('billing: plans, subscriptions, limits and Stripe payments', () => {
  let t: TestCtx;
  let s: ReturnType<typeof fakeStripe>;
  let root: TestUser;

  const webhook = (event: object, headerOverride?: string) => {
    const { payload, header } = s.sign(event);
    return t.http().post('/api/v1/payments/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', headerOverride ?? header).send(payload);
  };
  const live = (orgId: string) => t.db.subscription.findFirstOrThrow({ where: { organizationId: orgId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } }, include: { plan: true } });
  /** Time travel: the period ended `msAgo` ago (start moved too, so the period CHECK constraint holds). */
  const endPeriod = (id: string, msAgo: number) => {
    const end = new Date(Date.now() - msAgo);
    return t.db.subscription.update({ where: { id }, data: { currentPeriodStart: new Date(end.getTime() - 30 * 86_400_000), currentPeriodEnd: end } });
  };
  const freeOrg = async (name: string) => {
    const owner = await t.user(name);
    return { owner, org: await t.createOrg(owner, undefined, 'FREE') };
  };

  beforeAll(async () => {
    s = fakeStripe();
    t = await createTestApp({}, { paymentProvider: s.provider });
    root = await t.user('billing-root');
    await t.grantPlatformRole(root.id, 'SUPER_ADMIN');
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(() => t.close());

  describe('plans', () => {
    it('lists active public plans without authentication, enterprise hidden', async () => {
      const res = await t.http().get('/api/v1/plans').expect(200);
      const codes = res.body.map((p: { code: string }) => p.code);
      expect(codes).toEqual(expect.arrayContaining(['FREE', 'BASIC', 'PRO', 'BUSINESS']));
      expect(codes).not.toContain('ENTERPRISE');
      const pro = res.body.find((p: { code: string }) => p.code === 'PRO');
      expect(pro).toMatchObject({ priceMinor: 4900, currency: 'USD', interval: 'MONTH', trialDays: 14 });
      expect(pro.features['api_access']).toEqual({ enabled: true, limit: null });
    });

    it('admins create, edit and delete plans; validation and dependency checks hold', async () => {
      const code = `TEST_${randomUUID().slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
      await root.post('/admin/plans', { code, name: 'Test', priceMinor: 900, currency: 'USD', interval: 'MONTH', features: { 'made.up': { enabled: true } } }).expect(400);
      await root.post('/admin/plans', { code, name: 'Test', priceMinor: 900, currency: 'USD', interval: 'MONTH', features: { api_access: { enabled: true, limit: 5 } } }).expect(400);
      await root.post('/admin/plans', { code, name: 'Test', priceMinor: -1, currency: 'USD', interval: 'MONTH' }).expect(400);

      const created = (await root.post('/admin/plans', { code, name: 'Test', priceMinor: 900, currency: 'USD', interval: 'YEAR', features: { 'products.max': { enabled: true, limit: 50 } } }).expect(201)).body;
      expect(created.features['products.max']).toEqual({ enabled: true, limit: 50 });
      await root.post('/admin/plans', { code, name: 'Dup', priceMinor: 1, currency: 'USD', interval: 'MONTH' }).expect(409);

      const updated = (await root.patch(`/admin/plans/${created.id}`, { priceMinor: 1900, isPublic: false }).expect(200)).body;
      expect(updated).toMatchObject({ priceMinor: 1900, isPublic: false, code });
      await root.patch(`/admin/plans/${created.id}`, { code: 'RENAMED' }).expect(400); // code is immutable

      const pro = await t.db.plan.findUniqueOrThrow({ where: { code: 'PRO' } });
      const free = await t.db.plan.findUniqueOrThrow({ where: { code: 'FREE' } });
      await root.del(`/admin/plans/${free.id}`).expect(409);
      await root.del(`/admin/plans/${created.id}`).expect(204);

      const plain = await t.user('nobody');
      await plain.post('/admin/plans', { code: 'HACK', name: 'x', priceMinor: 0, currency: 'USD', interval: 'MONTH' }).expect(403);
      await plain.get('/admin/plans').expect(403);
      expect(pro.code).toBe('PRO');
    });
  });

  describe('new organizations and plan limits', () => {
    it('start on a Free subscription and report plan, features and usage', async () => {
      const { owner, org } = await freeOrg('starter');
      const sub = await live(org.id);
      expect(sub.plan.code).toBe('FREE');
      const res = await owner.get(`/organizations/${org.id}/subscription`).expect(200);
      expect(res.body.plan.code).toBe('FREE');
      expect(res.body.features['members.max']).toEqual({ enabled: true, limit: 1 });
      expect(res.body.features['api_access'].enabled).toBe(false);
      expect(res.body.usage['members.max']).toBe(1);
    });

    it('block what the plan does not allow with 402 and explain why — on the server, regardless of role', async () => {
      const { owner, org } = await freeOrg('limited');
      const staff = await t.systemRole('ORG_STAFF');
      const invite = await owner.post(`/organizations/${org.id}/invitations`, { email: 'second@example.com', roleId: staff.id }).expect(402);
      expect(invite.body.details).toMatchObject({ code: 'PLAN_RESTRICTION', limit: 'members.max', allowed: 1, used: 1, plan: 'FREE' });
      const key = await owner.post(`/organizations/${org.id}/api-keys`, { name: 'integration', scopes: ['catalog.read'] }).expect(402);
      expect(key.body.details).toMatchObject({ feature: 'api_access' });
    });

    it('organization API keys stop working when the plan loses API access', async () => {
      const { owner, org } = await freeOrg('downgraded');
      await root.post(`/admin/organizations/${org.id}/subscription`, { planCode: 'PRO', days: 30 }).expect(201);
      const key = (await owner.post(`/organizations/${org.id}/api-keys`, { name: 'k1', scopes: ['org.members.read'] }).expect(201)).body;
      await t.http().get(`/api/v1/organizations/${org.id}/members`).set('X-API-Key', key.secret).expect(200);

      const sub = await live(org.id);
      await root.post(`/admin/subscriptions/${sub.id}/terminate`).expect(204);
      expect((await live(org.id)).plan.code).toBe('FREE');
      const res = await t.http().get(`/api/v1/organizations/${org.id}/members`).set('X-API-Key', key.secret).expect(402);
      expect(res.body.details.feature).toBe('api_access');
    });

    it('enforce the daily API request quota for keys', async () => {
      const { owner, org } = await freeOrg('quota');
      const quota = `QUOTA_${randomUUID().slice(0, 5).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`;
      await root.post('/admin/plans', { code: quota, name: 'Quota', priceMinor: 100, currency: 'USD', interval: 'MONTH', isPublic: false, features: { api_access: { enabled: true }, 'api.requests_per_day': { enabled: true, limit: 2 }, 'members.max': { enabled: true, limit: 5 } } }).expect(201);
      await root.post(`/admin/organizations/${org.id}/subscription`, { planCode: quota, days: 30 }).expect(201);
      const key = (await owner.post(`/organizations/${org.id}/api-keys`, { name: 'quota key', scopes: ['org.members.read'] }).expect(201)).body;
      const call = () => t.http().get(`/api/v1/organizations/${org.id}/members`).set('X-API-Key', key.secret);
      await call().expect(200);
      await call().expect(200);
      await vi.waitFor(async () => expect(await t.db.apiLog.count({ where: { apiKeyId: key.id } })).toBe(2));
      const res = await call().expect(402);
      expect(res.body.details).toMatchObject({ limit: 'api.requests_per_day', allowed: 2 });
    });
  });

  describe('trial and lifecycle', () => {
    it('one free trial per organization; it unlocks the plan and expires back to Free', async () => {
      const { owner, org } = await freeOrg('trialist');
      const trial = (await owner.post(`/organizations/${org.id}/subscription/trial`, { planCode: 'PRO' }).expect(201)).body;
      expect(trial.status).toBe('TRIALING');
      expect(new Date(trial.trialEndsAt).getTime() - Date.now()).toBeGreaterThan(13 * 86_400_000);
      await owner.post(`/organizations/${org.id}/api-keys`, { name: 'during trial', scopes: ['catalog.read'] }).expect(201);
      await owner.post(`/organizations/${org.id}/subscription/trial`, { planCode: 'BUSINESS' }).expect(409);
      await owner.post(`/organizations/${org.id}/subscription/trial`, { planCode: 'ENTERPRISE' }).expect(404);

      await endPeriod(trial.id, 1000);
      await root.post('/admin/subscriptions/run-lifecycle').expect(200);
      expect((await t.db.subscription.findUniqueOrThrow({ where: { id: trial.id } })).status).toBe('EXPIRED');
      expect((await live(org.id)).plan.code).toBe('FREE');
      // Still only one trial, even after it ended.
      await owner.post(`/organizations/${org.id}/subscription/trial`, { planCode: 'PRO' }).expect(409);
    });

    it('unpaid periods go PAST_DUE (features kept), then EXPIRED after the grace period; cancel skips straight to Free', async () => {
      const a = await freeOrg('pastdue');
      const sub = (await root.post(`/admin/organizations/${a.org.id}/subscription`, { planCode: 'PRO', days: 30 }).expect(201)).body;
      await endPeriod(sub.id, 1000);
      await root.post('/admin/subscriptions/run-lifecycle').expect(200);
      expect((await live(a.org.id))).toMatchObject({ id: sub.id, status: 'PAST_DUE' });
      expect((await a.owner.get(`/organizations/${a.org.id}/subscription`).expect(200)).body.features.api_access.enabled).toBe(true);

      await endPeriod(sub.id, 4 * 86_400_000);
      await root.post('/admin/subscriptions/run-lifecycle').expect(200);
      expect((await live(a.org.id)).plan.code).toBe('FREE');

      const b = await freeOrg('canceller');
      const sb = (await root.post(`/admin/organizations/${b.org.id}/subscription`, { planCode: 'PRO', days: 30 }).expect(201)).body;
      expect((await b.owner.post(`/organizations/${b.org.id}/subscription/cancel`).expect(201)).body.cancelAtPeriodEnd).toBe(true);
      expect((await b.owner.post(`/organizations/${b.org.id}/subscription/resume`).expect(201)).body.cancelAtPeriodEnd).toBe(false);
      await b.owner.post(`/organizations/${b.org.id}/subscription/cancel`).expect(201);
      await endPeriod(sb.id, 1000);
      await root.post('/admin/subscriptions/run-lifecycle').expect(200);
      expect((await t.db.subscription.findUniqueOrThrow({ where: { id: sb.id } })).status).toBe('EXPIRED');
      expect((await live(b.org.id)).plan.code).toBe('FREE');

      const hist = (await b.owner.get(`/organizations/${b.org.id}/subscription/history`).expect(200)).body;
      expect(hist[1].events.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'CANCEL_SCHEDULED', 'RESUMED', 'CANCEL_SCHEDULED', 'EXPIRED']);
      await b.owner.post(`/organizations/${b.org.id}/subscription/cancel`).expect(409); // nothing paid to cancel
    });
  });

  describe('checkout and webhooks', () => {
    it('creates a pending payment and a Stripe Checkout session for exactly the plan price', async () => {
      const { owner, org } = await freeOrg('buyer');
      const res = await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).expect(201);
      expect(res.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
      expect(s.create).toHaveBeenCalledTimes(1);
      const [params, opts] = s.create.mock.calls[0]!;
      expect(params).toMatchObject({ mode: 'payment', client_reference_id: res.body.paymentId, line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 4900 } }] });
      expect(params.success_url).toContain(`/dashboard/${org.slug}/billing?payment=${res.body.paymentId}`);
      expect(opts).toEqual({ idempotencyKey: `checkout:${res.body.paymentId}` });
      expect(await t.db.payment.findUniqueOrThrow({ where: { id: res.body.paymentId } })).toMatchObject({ status: 'PENDING', amountMinor: 4900n, currency: 'USD', provider: 'stripe' });

      await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'FREE' }).expect(422);
      await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'ENTERPRISE' }).expect(404);
      await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO', amountMinor: 1 }).expect(400);
    });

    it('Idempotency-Key: a retried request returns the first payment instead of creating another', async () => {
      const { owner, org } = await freeOrg('retrier');
      const key = `idem-${randomUUID()}`;
      const first = await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'BASIC' }).set('Idempotency-Key', key).expect(201);
      const again = await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'BASIC' }).set('Idempotency-Key', key).expect(201);
      expect(again.body.paymentId).toBe(first.body.paymentId);
      expect(s.create).toHaveBeenCalledTimes(1);
      await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).set('Idempotency-Key', key).expect(422);
      await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).set('Idempotency-Key', 'bad key!').expect(400);
      expect(await t.db.payment.count({ where: { organizationId: org.id } })).toBe(1);
    });

    it('a paid webhook activates the plan once; redelivery and late events change nothing', async () => {
      const { owner, org } = await freeOrg('payer');
      const { paymentId } = (await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).expect(201)).body;
      const payment = await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const evt = s.pay(payment.providerPaymentId!);

      await webhook(evt).expect(200, { received: true });
      const paid = await t.db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { transactions: true } });
      expect(paid.status).toBe('SUCCEEDED');
      expect(paid.transactions).toHaveLength(1);
      const sub = await live(org.id);
      expect(sub).toMatchObject({ status: 'ACTIVE', id: paid.subscriptionId });
      expect(sub.plan.code).toBe('PRO');
      expect(Math.round((sub.currentPeriodEnd.getTime() - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(27);

      await webhook(evt).expect(200, { received: true, duplicate: true });
      await webhook(s.event('checkout.session.async_payment_succeeded', evt.data.object)).expect(200);
      expect(await t.db.transaction.count({ where: { paymentId } })).toBe(1);
      expect(await t.db.subscription.count({ where: { organizationId: org.id, status: 'ACTIVE' } })).toBe(1);
      expect(await t.db.webhookEvent.count({ where: { eventId: evt.id } })).toBe(1);

      // The org can now use what it paid for.
      await owner.post(`/organizations/${org.id}/api-keys`, { name: 'paid', scopes: ['catalog.read'] }).expect(201);
    });

    it('renewing the same plan extends the period from its end — paying early never loses days', async () => {
      const { owner, org } = await freeOrg('renewer');
      const buy = async () => {
        const { paymentId } = (await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'BASIC' }).expect(201)).body;
        const p = await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
        await webhook(s.pay(p.providerPaymentId!)).expect(200);
      };
      await buy();
      const first = await live(org.id);
      await buy();
      const second = await live(org.id);
      expect(second.id).toBe(first.id);
      expect(second.currentPeriodEnd.toISOString()).toBe(addInterval(first.currentPeriodEnd, 'MONTH').toISOString());
      const events = await t.db.subscriptionEvent.findMany({ where: { subscriptionId: first.id }, orderBy: { createdAt: 'asc' } });
      expect(events.map((e) => e.type)).toEqual(['UPGRADED', 'RENEWED']);
    });

    it('rejects a "paid" event whose amount or currency differs from what we charged', async () => {
      const { owner, org } = await freeOrg('tampered');
      const { paymentId } = (await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'BUSINESS' }).expect(201)).body;
      const p = await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await webhook(s.pay(p.providerPaymentId!, { amount_total: 100 })).expect(200);
      expect(await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: 'FAILED', failureReason: 'amount_mismatch' });
      expect((await live(org.id)).plan.code).toBe('FREE');
    });

    it('rejects forged, unsigned, stale or tampered webhooks (400) without side effects', async () => {
      const { owner, org } = await freeOrg('forged');
      const { paymentId } = (await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).expect(201)).body;
      const p = await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const evt = s.pay(p.providerPaymentId!);

      await t.http().post('/api/v1/payments/webhooks/stripe').set('Content-Type', 'application/json').send(JSON.stringify(evt)).expect(400);
      await webhook(evt, 't=1,v1=deadbeef').expect(400);
      const stale = new Stripe('sk_test_x').webhooks.generateTestHeaderString({ payload: JSON.stringify(evt), secret: WEBHOOK_SECRET, timestamp: Math.floor(Date.now() / 1000) - 3600 });
      await webhook(evt, stale).expect(400);
      const { header } = s.sign(evt);
      await t.http().post('/api/v1/payments/webhooks/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', header).send(JSON.stringify({ ...evt, id: 'evt_other' })).expect(400);

      expect((await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING');
      expect(await t.db.webhookEvent.count({ where: { eventId: evt.id } })).toBe(0);
    });

    it('expired sessions cancel the payment; unknown sessions and event types are acknowledged and ignored', async () => {
      const { owner, org } = await freeOrg('expirer');
      const { paymentId } = (await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).expect(201)).body;
      const p = await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
      await webhook(s.event('checkout.session.expired', { ...s.sessions.get(p.providerPaymentId!), status: 'expired' })).expect(200);
      expect((await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('CANCELED');

      const stranger = s.event('checkout.session.completed', { id: 'cs_not_ours', object: 'checkout.session', payment_status: 'paid', amount_total: 1, currency: 'usd', payment_intent: 'pi_x' });
      await webhook(stranger).expect(200);
      const other = s.event('customer.created', { id: 'cus_1', object: 'customer' });
      await webhook(other).expect(200);
      expect((await t.db.webhookEvent.findFirstOrThrow({ where: { eventId: other.id } })).status).toBe('IGNORED');
    });

    it('sync confirms a payment with Stripe when the buyer returns before the webhook', async () => {
      const { owner, org } = await freeOrg('syncer');
      const { paymentId } = (await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'BASIC' }).expect(201)).body;
      const p = await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
      s.pay(p.providerPaymentId!); // paid at Stripe, webhook not delivered yet
      const res = await owner.post(`/organizations/${org.id}/payments/${paymentId}/sync`).expect(200);
      expect(res.body.status).toBe('SUCCEEDED');
      expect(s.retrieve).toHaveBeenCalledWith(p.providerPaymentId);
      expect((await live(org.id)).plan.code).toBe('BASIC');
    });

    it('answers 503 for checkout when no payment provider is configured', async () => {
      const bare = await createTestApp();
      try {
        const owner = await bare.user('nopay');
        const org = await bare.createOrg(owner, undefined, 'FREE');
        await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).expect(503);
      } finally {
        await bare.close();
      }
    });
  });

  describe('refunds', () => {
    it('admins refund partially then fully; refunds are capped and confirmed by webhooks', async () => {
      const { owner, org } = await freeOrg('refundee');
      const { paymentId } = (await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).expect(201)).body;
      const p = await t.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const evt = s.pay(p.providerPaymentId!);
      await webhook(evt).expect(200);
      const pi = (evt.data.object as { payment_intent: string }).payment_intent;

      await owner.post(`/admin/payments/${paymentId}/refund`, { amountMinor: 100 }).expect(403);
      const partial = await root.post(`/admin/payments/${paymentId}/refund`, { amountMinor: 1000, reason: 'goodwill' }).expect(201);
      expect(partial.body.status).toBe('PARTIALLY_REFUNDED');
      expect(s.refundsCreate).toHaveBeenCalledWith({ payment_intent: pi, amount: 1000 }, { idempotencyKey: `refund:${paymentId}:1` });
      await root.post(`/admin/payments/${paymentId}/refund`, { amountMinor: 3901 }).expect(422);

      // Stripe reports the rest refunded from its dashboard; the webhook completes the picture.
      await webhook(s.event('refund.updated', { id: 're_dash_1', object: 'refund', amount: 3900, currency: 'usd', status: 'succeeded', payment_intent: pi })).expect(200);
      const final = await owner.get(`/organizations/${org.id}/payments/${paymentId}`).expect(200);
      expect(final.body.status).toBe('REFUNDED');
      expect(final.body.transactions.map((x: { type: string }) => x.type)).toEqual(['CHARGE', 'REFUND', 'REFUND']);
      await root.post(`/admin/payments/${paymentId}/refund`, {}).expect(409);
    });
  });

  describe('access to billing data', () => {
    it('follows roles inside the organization and never crosses organizations', async () => {
      const { owner, org } = await freeOrg('privacy');
      const { paymentId } = (await owner.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).expect(201)).body;

      const admin = await t.user('org-admin');
      const staff = await t.user('org-staff');
      await t.addMember(org.id, admin, 'ORG_ADMIN');
      await t.addMember(org.id, staff, 'ORG_STAFF');
      await admin.get(`/organizations/${org.id}/payments`).expect(200);
      await admin.post(`/organizations/${org.id}/subscription/checkout`, { planCode: 'PRO' }).expect(403); // no org.billing.manage
      await staff.get(`/organizations/${org.id}/subscription`).expect(403);

      const other = await freeOrg('outsider');
      await other.owner.get(`/organizations/${org.id}/payments/${paymentId}`).expect(404);
      await other.owner.get(`/organizations/${other.org.id}/payments/${paymentId}`).expect(404);
      await other.owner.post(`/organizations/${other.org.id}/payments/${paymentId}/sync`).expect(404);
      expect((await other.owner.get(`/organizations/${other.org.id}/payments`).expect(200)).body.total).toBe(0);
    });

    it('platform admins see all payments and subscriptions; others cannot', async () => {
      await root.get('/admin/payments?status=SUCCEEDED').expect(200);
      await root.get('/admin/subscriptions?status=ACTIVE&pageSize=5').expect(200);
      const plain = await t.user('noadmin');
      await plain.get('/admin/payments').expect(403);
      await plain.post('/admin/subscriptions/run-lifecycle').expect(403);
    });
  });
});
