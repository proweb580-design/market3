import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import Stripe from 'stripe';
import { URLS, WEBHOOK_SECRET } from './env.mjs';

export const PASSWORD = 'e2e-password-123';
export const uniqueEmail = (name = 'user') => `${name}-${randomUUID().slice(0, 8)}@e2e.test`;

/** Registers through the real sign-up page (the fake Supabase confirms at once) and waits for the account page. */
export async function signUp(page: Page, email: string, password = PASSWORD) {
  await page.goto('/register');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#repeat').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/account/);
}

export async function signIn(page: Page, email: string, password = PASSWORD, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signOutViaApp(page: Page) {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page).toHaveURL(URLS.web + '/');
}

interface FakeSession {
  id: string;
  amount_total: number;
  currency: string;
  success_url: string;
  payment_status: string;
  payment_intent: string | null;
}

/** All checkout sessions the platform created at the fake Stripe. */
export async function stripeSessions(): Promise<FakeSession[]> {
  return (await fetch(`${URLS.stripe}/__control/sessions`)).json() as Promise<FakeSession[]>;
}

/**
 * The shopper "pays" at the fake Stripe page: it marks the session paid and then delivers a correctly signed
 * `checkout.session.completed` webhook to the API — the same message real Stripe sends.
 */
export async function payAtStripe(sessionId: string) {
  const paid = (await (await fetch(`${URLS.stripe}/__control/pay/${sessionId}`, { method: 'POST' })).json()) as FakeSession;
  const stripe = new Stripe('sk_test_signing_only');
  const payload = JSON.stringify({
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    object: 'event',
    type: 'checkout.session.completed',
    api_version: '2026-10-28.endive',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: paid },
  });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const res = await fetch(`${URLS.api}/api/v1/payments/webhooks/stripe`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header }, body: payload });
  expect(res.status).toBe(200);
  return paid;
}

/** A tiny valid PNG, for upload tests. */
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Our own alert message (Next.js also keeps an empty role=alert element for route announcements). */
export const alertOf = (page: Page) => page.locator('[role=alert]:not(#__next-route-announcer__)');

/** A variant id of the product that can really be bought (the demo catalogue has some sold-out sizes). */
export async function inStockVariant(store: string, slug: string): Promise<string> {
  const catalog = (await (await fetch(`${URLS.api}/api/v1/storefront/${store}/catalog`)).json()) as {
    products: { slug: string; sizes: { label: string; inStock: boolean }[]; variants: { id: string; size: string | null }[] }[];
  };
  const product = catalog.products.find((p) => p.slug === slug)!;
  const size = product.sizes.find((x) => x.inStock)!.label;
  return product.variants.find((v) => (v.size ?? 'One size') === size)!.id;
}
