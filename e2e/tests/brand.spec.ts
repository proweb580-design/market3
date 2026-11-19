import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { URLS } from '../support/env.mjs';
import { payAtStripe, PNG_1X1, signUp, uniqueEmail } from '../support/helpers';

test('a brand creates a store, lists a product with a photo, sells it and fulfils the order', async ({ page }) => {
  const slug = `e2e-${randomUUID().slice(0, 8)}`;
  await signUp(page, uniqueEmail('brand'));

  // ── create the store ──
  await page.goto('/dashboard');
  await page.getByLabel('Store name').fill('E2E Brand');
  await page.getByLabel('Address').fill(slug);
  await page.getByRole('button', { name: 'Create store' }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/${slug}$`));
  await expect(page.getByRole('heading', { name: 'E2E Brand' })).toBeVisible();

  // ── a product with three sizes and a photo ──
  await page.getByRole('link', { name: 'Products' }).first().click();
  await page.getByRole('link', { name: 'New product' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Test Jacket');
  await page.locator('form').getByLabel('Status').selectOption('ACTIVE');
  await page.getByLabel('Price', { exact: true }).first().fill('99.00');
  for (const [i, field] of (await page.getByLabel('Price', { exact: true }).all()).entries()) {
    await field.fill('99.00');
    await page.getByLabel('Stock', { exact: true }).nth(i).fill('5');
  }

  await page.locator('input[type=file]').first().setInputFiles({ name: 'jacket.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(page.locator(`img[src^="${URLS.supabase}/storage/v1/object/public/media/"]`).first()).toBeVisible(); // uploaded, verified, recorded

  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByText('Test Jacket')).toBeVisible();

  // ── the shopper sees it ──
  await page.goto(`/s/${slug}/products/test-jacket`);
  await expect(page.getByRole('heading', { name: /Test Jacket/i }).first()).toBeVisible();
  await expect(page.getByText('$99.00').first()).toBeVisible();

  // ── a guest buys it (through the public API) and pays ──
  const catalog = (await (await fetch(`${URLS.api}/api/v1/storefront/${slug}/catalog`)).json()) as { products: { variants: { id: string }[] }[] };
  const order = await fetch(`${URLS.api}/api/v1/storefront/${slug}/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: [{ variantId: catalog.products[0]!.variants[0]!.id, quantity: 2 }], email: uniqueEmail('guest'), shippingAddress: { name: 'Guest', line1: '1 Street', city: 'Rome', postalCode: '00100', country: 'IT' } }),
  });
  expect(order.status).toBe(201);
  const placed = (await order.json()) as { checkoutUrl: string };
  await payAtStripe(placed.checkoutUrl.split('/').pop()!);

  // ── the brand fulfils it ──
  await page.goto(`/dashboard/${slug}/orders`);
  await expect(page.getByRole('link', { name: /#\d+/ }).first().getByText('Paid — to fulfil')).toBeVisible();
  await page.getByRole('link', { name: /#\d+/ }).first().click();
  await page.getByRole('button', { name: 'Mark as fulfilled' }).click();
  await expect(page.getByText(/Fulfilled/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as fulfilled' })).toHaveCount(0);
});

test("another account cannot open someone else's dashboard", async ({ browser }) => {
  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  const slug = `e2e-${randomUUID().slice(0, 8)}`;
  await signUp(ownerPage, uniqueEmail('owner'));
  await ownerPage.goto('/dashboard');
  await ownerPage.getByLabel('Store name').fill('Private Store');
  await ownerPage.getByLabel('Address').fill(slug);
  await ownerPage.getByRole('button', { name: 'Create store' }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/dashboard/${slug}$`));
  await owner.close();

  const intruder = await browser.newContext();
  const page = await intruder.newPage();
  await signUp(page, uniqueEmail('intruder'));
  await page.goto(`/dashboard/${slug}/orders`);
  await expect(page.getByText(/not found, or you are not a member/i)).toBeVisible();
  await intruder.close();
});

test('the dashboard and admin are closed to signed-out visitors', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=/);
});
