import { expect, test } from '@playwright/test';
import { SUPERADMIN_EMAIL } from '../support/env.mjs';
import { alertOf, PASSWORD, signIn, signUp, uniqueEmail } from '../support/helpers';

test('a regular account is not allowed into the platform admin', async ({ page }) => {
  await signUp(page, uniqueEmail('plain'));
  await page.goto('/admin');
  await expect(page.getByText('This area is for platform administrators.')).toBeVisible();
});

test('the super admin blocks a user, who is then locked out; plans can be created', async ({ browser }) => {
  // The shopper to be blocked, signed in and looking at their account.
  const victimEmail = uniqueEmail('victim');
  const victimCtx = await browser.newContext();
  const victim = await victimCtx.newPage();
  await signUp(victim, victimEmail);
  await expect(victim.getByRole('heading', { name: victimEmail })).toBeVisible();

  // The super admin (seeded with SEED_SUPER_ADMIN_EMAIL) signs up with that e-mail and is linked to the seeded account.
  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signUp(admin, SUPERADMIN_EMAIL);
  await admin.goto('/admin');
  await expect(admin.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(admin.getByText('Live subscriptions')).toBeVisible();

  admin.on('dialog', (d) => void d.accept());
  await admin.goto('/admin/users');
  await admin.getByLabel('Search').fill(victimEmail);
  await admin.getByRole('link', { name: new RegExp(victimEmail) }).click();
  await admin.getByRole('button', { name: 'Block' }).click();
  await expect(admin.getByText(/blocked/i).first()).toBeVisible();

  // The blocked user is refused immediately, even though their Supabase token is still valid.
  await victim.reload();
  await expect(alertOf(victim)).toBeVisible();
  await expect(victim.getByRole('heading', { name: victimEmail })).toHaveCount(0);

  // …and can be let back in. Their old sessions stay revoked, so they sign in again.
  await admin.getByRole('button', { name: 'Unblock' }).click();
  await signIn(victim, victimEmail, PASSWORD, '/account');
  await expect(victim.getByRole('heading', { name: victimEmail })).toBeVisible();

  // Plans: create one and see it listed.
  await admin.goto('/admin/plans');
  await admin.getByRole('button', { name: 'New plan' }).click();
  await admin.getByLabel('Code').fill('E2E_PLAN');
  await admin.getByLabel('Name', { exact: true }).fill('E2E Plan');
  await admin.getByLabel('Price').fill('12.00');
  await admin.getByRole('button', { name: 'Save plan' }).click();
  await expect(admin.getByText('E2E Plan')).toBeVisible();

  // Audit trail recorded the block.
  await admin.goto('/admin/audit');
  await admin.getByLabel('Action starts with').fill('user.');
  await expect(admin.getByText('user.blocked').first()).toBeVisible();

  await victimCtx.close();
  await adminCtx.close();
});

test('the seeded admin password is whatever Supabase says — the platform never sees passwords', async ({ page }) => {
  await signIn(page, 'nobody@e2e.test', PASSWORD);
  await expect(alertOf(page)).toHaveText('Wrong email or password.');
});
