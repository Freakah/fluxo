// Regenerates docs/screenshots (demo data only): npm run build && npm run screenshots
import { test, expect, type Page } from '@playwright/test';

async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: /Dashboard/ })).toBeVisible();
}

test('screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await demo(page);
  await page.screenshot({ path: 'docs/screenshots/dashboard.png' });
  for (const [path, file] of [['/transactions', 'transactions'], ['/budgets', 'budgets'], ['/recurring', 'recurring'], ['/reports', 'reports'], ['/accounts', 'accounts'], ['/review', 'review']] as const) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `docs/screenshots/${file}.png` });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'docs/screenshots/dashboard-dark.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/transactions');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'docs/screenshots/mobile-transactions.png' });
});
