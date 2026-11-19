import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { vi } from 'vitest';
import { StripeProvider } from '../src/modules/billing/payments/stripe.provider.js';

export const WEBHOOK_SECRET = 'whsec_test_secret_for_signatures';

/**
 * The real Stripe SDK and the real StripeProvider; only the three network calls are stubbed.
 * Webhook signatures are produced by Stripe's own test helper, so signature verification is exercised for real.
 */
export function fakeStripe() {
  const stripe = new Stripe('sk_test_dummy_key_for_tests');
  const sessions = new Map<string, Stripe.Checkout.Session>();
  const create = vi.fn(async (params: Stripe.Checkout.SessionCreateParams, _opts?: { idempotencyKey?: string }) => {
    const id = `cs_test_${randomUUID().replace(/-/g, '')}`;
    const session = {
      id,
      object: 'checkout.session',
      url: `https://checkout.stripe.com/c/pay/${id}`,
      expires_at: params.expires_at!,
      amount_total: params.line_items![0]!.price_data!.unit_amount!,
      currency: params.line_items![0]!.price_data!.currency,
      payment_status: 'unpaid',
      status: 'open',
      payment_intent: null,
      client_reference_id: params.client_reference_id,
    } as unknown as Stripe.Checkout.Session;
    sessions.set(id, session);
    return session;
  });
  const retrieve = vi.fn(async (id: string) => sessions.get(id)!);
  const refundsCreate = vi.fn(async (params: Stripe.RefundCreateParams) => ({ id: `re_${randomUUID().slice(0, 12)}`, status: 'succeeded', amount: params.amount }) as unknown as Stripe.Refund);
  Object.assign(stripe.checkout.sessions, { create, retrieve });
  Object.assign(stripe.refunds, { create: refundsCreate });

  const sign = (event: object) => {
    const payload = JSON.stringify(event);
    return { payload, header: stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) };
  };
  const event = (type: string, object: object, id = `evt_${randomUUID().replace(/-/g, '')}`) => ({
    id,
    object: 'event',
    type,
    api_version: '2026-10-28.endive',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  });
  /** Marks a stored session as paid (as Stripe would) and returns the matching completed event. */
  const pay = (sessionId: string, over: Partial<{ amount_total: number; currency: string }> = {}) => {
    const s = sessions.get(sessionId)! as unknown as Record<string, unknown>;
    Object.assign(s, { payment_status: 'paid', status: 'complete', payment_intent: `pi_${randomUUID().slice(0, 12)}`, ...over });
    return event('checkout.session.completed', { ...s });
  };

  return { provider: new StripeProvider(stripe, WEBHOOK_SECRET), create, retrieve, refundsCreate, sign, event, pay, sessions };
}

