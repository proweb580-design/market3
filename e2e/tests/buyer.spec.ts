import { expect, test } from '@playwright/test';
import { payAtStripe, stripeSessions, uniqueEmail } from '../support/helpers';

test('a guest buys a T-shirt: cart → checkout → payment page → confirmed order', async ({ page }) => {
  await page.goto('/s/ashen/products/signal-tee-black');
  await expect(page.getByRole('heading', { name: /Signal Tee/i }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Размер M', exact: true }).click();
  await page.locator('button:visible', { hasText: /В корзину/ }).first().click();

  // The cart drawer opens with the line and the server-independent subtotal.
  await expect(page.getByText('Корзина (1)')).toBeVisible();
  await page.getByRole('checkbox', { name: /Я согласен/ }).click();
  await page.getByRole('button', { name: /^Оформить заказ/ }).click();

  // Checkout page: totals come from the server (60.00 item + 10.00 flat shipping, free-shipping starts at 150.00).
  await expect(page.getByText('Итого').last()).toBeVisible();
  await expect(page.getByText('$70.00').first()).toBeVisible();

  const email = uniqueEmail('buyer');
  await page.locator('#co-email').fill(email);
  await page.locator('#co-name').fill('Ada Buyer');
  await page.locator('#co-line1').fill('1 Main Street');
  await page.locator('#co-city').fill('Berlin');
  await page.locator('#co-postalCode').fill('10115');
  await page.locator('#co-country').fill('de');
  await page.getByRole('button', { name: /^Оплатить/ }).click();

  // Redirected to the (fake) hosted payment page for exactly the server-computed amount.
  await expect(page.getByRole('heading', { name: 'Fake Stripe Checkout' })).toBeVisible();
  await expect(page.locator('#amount')).toHaveText('7000 usd');
  const sessionId = (await page.locator('#session').textContent())!.trim();

  // Before payment the order page says so…
  const session = (await stripeSessions()).find((s) => s.id === sessionId)!;
  await page.goto(session.success_url);
  await expect(page.getByRole('heading', { name: 'Ожидаем оплату' })).toBeVisible();

  // …after the signed webhook arrives it is confirmed, with the right totals.
  await payAtStripe(sessionId);
  await page.reload();
  await expect(page.getByRole('heading', { name: /заказ подтверждён/i })).toBeVisible();
  await expect(page.getByText('$70.00').last()).toBeVisible();
  await expect(page.getByText(/Signal Tee \(Black\) · M/)).toBeVisible();
});

test('the order page is private: wrong or missing token shows nothing', async ({ page }) => {
  await page.goto('/s/ashen/orders/01a1f357-34b6-7242-82f3-1bf747ded5d8?token=' + 'A'.repeat(43));
  await expect(page.getByText(/не нашли этот заказ/i)).toBeVisible();
  await page.goto('/s/ashen/orders/01a1f357-34b6-7242-82f3-1bf747ded5d8');
  await expect(page.getByText(/не нашли этот заказ/i)).toBeVisible();
});

test('sold-out sizes cannot be chosen, and an unknown store shows a not-found page', async ({ page }) => {
  await page.goto('/s/ashen/products/signal-tee-black');
  await expect(page.getByRole('button', { name: /нет в наличии/i }).first()).toBeDisabled();
  // shortcut: the page streams, so the HTTP status is already 200 when the store turns out not to exist (the page carries noindex).
  await page.goto('/s/no-such-store');
  await expect(page.getByText(/could not be found|404/i).first()).toBeVisible();
  await expect(page.locator('meta[name=robots]').first()).toHaveAttribute('content', /noindex/);
});
