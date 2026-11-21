import { expect, test } from '@playwright/test';
import { URLS } from '../support/env.mjs';
import { alertOf, inStockVariant, PASSWORD, signIn, signOutViaApp, signUp, uniqueEmail } from '../support/helpers';

/** A guest order placed straight through the public API (the buyer flow itself is covered in buyer.spec). */
async function guestOrder(email: string) {
  const variantId = await inStockVariant('ashen', 'night-hoodie-black');
  const res = await fetch(`${URLS.api}/api/v1/storefront/ashen/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: [{ variantId, quantity: 1 }], email, shippingAddress: { name: 'Guest', line1: '1 Street', city: 'Paris', postalCode: '75001', country: 'FR' } }),
  });
  expect(res.status).toBe(201);
}

test('register, sign out, sign in — and a guest order with the same email joins the account', async ({ page }) => {
  const email = uniqueEmail('shopper');
  await guestOrder(email);

  await signUp(page, email);
  await expect(page.getByRole('heading', { name: email })).toBeVisible();
  await expect(page.getByText(/Ashen · #\d+/)).toBeVisible(); // claimed automatically

  await signOutViaApp(page);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?next=/); // signed out → the account page is closed

  await signIn(page, email, PASSWORD, '/account');
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByText(/Ashen · #\d+/)).toBeVisible();
});

test('sign-in errors are friendly, and registering twice is refused', async ({ page }) => {
  const email = uniqueEmail('dupe');
  await signUp(page, email);
  await signOutViaApp(page);

  await signIn(page, email, 'wrong-password-1');
  await expect(alertOf(page)).toHaveText('Wrong email or password.');

  await page.goto('/register');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#repeat').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(alertOf(page)).toContainText('already exists');
});

test('registration checks the form before asking the server', async ({ page }) => {
  await page.goto('/register');
  await page.locator('#email').fill(uniqueEmail());
  await page.locator('#password').fill('short');
  await page.locator('#repeat').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(alertOf(page)).toHaveText('Choose a password of at least 8 characters.');
});

test('password reset gives the same answer for any address', async ({ page }) => {
  await page.goto('/forgot-password');
  await page.locator('#email').fill('nobody-here@e2e.test');
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists');
});

test('the wishlist belongs to the account and follows the shopper across sessions', async ({ browser }) => {
  const email = uniqueEmail('hearts');
  const first = await browser.newContext();
  const page = await first.newPage();
  await signUp(page, email);

  await page.goto('/s/ashen/products/heat-shell-graphite');
  await page.locator('button[aria-label="Добавить в избранное"]:visible').click();
  await expect(page.locator('button[aria-label="Убрать из избранного"]:visible')).toBeVisible();
  await first.close();

  // A brand-new browser (no local storage): signing in brings the heart back from the server.
  const second = await browser.newContext();
  const again = await second.newPage();
  await signIn(again, email, PASSWORD, '/account');
  await expect(again).toHaveURL(/\/account/);
  await again.goto('/s/ashen/products/heat-shell-graphite');
  await expect(again.locator('button[aria-label="Убрать из избранного"]:visible')).toBeVisible();
  await second.close();
});
