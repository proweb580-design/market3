import { expect, test } from '@playwright/test';

test('the home address opens the catalogue straight away — no landing page, no links to the dashboard or admin', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/s\/ashen$/);
  await expect(page.getByRole('heading', { name: 'FW26' }).first()).toBeVisible();
  // Nothing on the public pages advertises the brand dashboard or the platform admin.
  await expect(page.locator('a[href^="/dashboard"], a[href^="/admin"]')).toHaveCount(0);
});
