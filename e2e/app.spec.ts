import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import fs from 'node:fs';

async function startDemo(page: Page, { welcome = 'skip' }: { welcome?: 'skip' | 'keep' } = {}) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'Demo mode' })).toBeVisible();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Welcome to Fluxo' })).toBeVisible();
  if (welcome === 'skip') {
    await dialog.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByRole('heading', { name: /Dashboard/ })).toBeVisible();
  }
}

async function go(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name, exact: true }).click();
}

async function a11y(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test('welcome, tour and home', async ({ page }) => {
  await startDemo(page, { welcome: 'keep' });
  const dialog = page.getByRole('dialog');
  await a11y(page);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'Connect your bank safely' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Show me around' }).click();
  const tour = page.getByRole('dialog', { name: 'Home' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Activity' })).toBeVisible();
  await page.getByRole('button', { name: 'End tour' }).click();
  await expect(page.getByRole('heading', { name: /Dashboard/ })).toBeVisible();

  for (const t of ['You have spent', 'Money in', 'Left over', 'Monthly budget']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Bank access expired/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your accounts' })).toBeVisible();
  await expect(page.getByText(/Available \(interim\)/).first()).toBeVisible();
  await page.getByRole('button', { name: 'About the budget' }).click();
  await expect(page.getByText(/not your bank balance/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome to Fluxo' })).toHaveCount(0); // shown once
  await a11y(page);
});

test('activity search, filters and detail', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Activity');
  await page.getByLabel('Search merchant, description or note').fill('pingo doce amoreiras');
  await expect(page.getByText(/^1 transactions/)).toBeVisible();
  await page.getByRole('button', { name: /Open Pingo Doce/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('From your bank (never changed by Fluxo)').click();
  await expect(dialog.getByText('COMPRA 4521 PINGO DOCE AMOREIRAS')).toBeVisible();
  await expect(dialog.getByText('Pending amount was')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByLabel('Search merchant, description or note').fill('');
  await page.getByLabel('Status').selectOption('pending');
  await expect(page).toHaveURL(/status=pending/);
  await expect(page.getByText(/^[1-9] transactions/)).toBeVisible();
  const items = page.locator('.txlist .tx');
  await expect(items.first()).toBeVisible();
  for (const b of await items.all()) await expect(b.locator('.badge-warn', { hasText: 'Processing' })).toBeVisible();
  await a11y(page);
});

test('category correction remembered as a rule', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Activity');
  await page.getByLabel('Search merchant, description or note').fill('PAG SERV ENT 21025');
  await expect(page.getByText(/^6 transactions/)).toBeVisible();
  await page.getByRole('button', { name: /^Open / }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Utilities' }).click();
  await dialog.getByLabel(/Also apply to future and past/).check();
  await expect(dialog.getByText(/transactions match; would change/)).toBeVisible();
  await a11y(page);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved and rule created')).toBeVisible();
  await expect(page.locator('.txlist .tx').first().getByText('Utilities')).toBeVisible();
  await go(page, 'Categories');
  await page.getByRole('tab', { name: /Rules/ }).click();
  await expect(page.getByRole('list', { name: 'Rules in priority order' }).locator('q', { hasText: /Payment to entity 21025/ })).toBeVisible();
  await a11y(page);
});

test('budget setup with the guided steps', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Budgets');
  await expect(page.getByRole('heading', { name: 'Restaurants & cafés' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Monthly amount (EUR)').fill('2500');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByText(/of €2,500\.00/)).toBeVisible();
  await page.getByRole('button', { name: 'Add category budget' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Health' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByText(/a month lately|Not enough history/)).toBeVisible();
  await dialog.getByLabel('Monthly amount (EUR)').fill('40');
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible();
  await page.getByRole('button', { name: 'More information' }).click();
  await expect(page.getByText(/not added on top of it/)).toBeVisible();
  await a11y(page);
});

test('bills review with undo', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Bills');
  await page.getByRole('button', { name: 'About Bills and subscriptions' }).click();
  await expect(page.getByText(/Dates and amounts are estimates/)).toBeVisible();
  await expect(page.getByRole('group', { name: /Expected payments in/ })).toBeVisible();
  await page.getByRole('listitem', { name: 'Fitness Hut' }).getByRole('button', { name: 'Yes, it repeats' }).click();
  await expect(page.getByRole('tab', { name: /Confirmed \(4\)/ })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('tab', { name: /Confirmed \(3\)/ })).toBeVisible();
  await a11y(page);
});

test('insights and CSV export', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Insights');
  await expect(page.getByRole('heading', { name: 'Spending by category' })).toBeVisible();
  await page.getByRole('tab', { name: 'Month by month' }).click();
  await expect(page.getByRole('heading', { name: 'Income vs spending by month' })).toBeVisible();
  await page.getByRole('button', { name: 'Show as table' }).first().click();
  await expect(page.getByRole('table').first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
  const csv = fs.readFileSync((await download.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM so Excel reads accents
  expect(csv.slice(1).split('\r\n')[0]).toBe('booking_date,value_date,status,account,merchant,bank_description,counterparty,amount,currency,pending_amount,type,category,category_source,excluded_from_reports,note,source');
  expect(csv).toContain('Pingo Doce');
  await a11y(page);
});

test('settings, privacy toggle, full export and deletion', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('button', { name: 'Hide amounts' }).click();
  await expect(page.locator('.hero-big').first()).toContainText('•••••');
  await page.getByRole('button', { name: 'Show amounts' }).click();
  await go(page, 'Settings');
  await page.getByRole('radio', { name: /Dark/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await a11y(page);
  await page.getByRole('tab', { name: /Privacy and data/ }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Download all my data/ }).click()]);
  const data = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'));
  expect(data.format).toBe('fluxo-export');
  expect(JSON.stringify(data)).not.toMatch(/password_hash|provider_session/);
  await page.getByRole('button', { name: 'Delete all imported bank data' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
  await dialog.getByLabel(/Type DELETE to confirm/).fill('DELETE');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('All imported bank data deleted.')).toBeVisible();
  await go(page, 'Home');
  await expect(page.getByText('Connect your first bank')).toBeVisible();
  await a11y(page);
});

test('connect flow through the simulated bank reuses existing accounts', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Banks');
  await page.getByRole('button', { name: 'Connect a bank' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Read-only', { exact: true })).toBeVisible();
  await a11y(page);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Millennium bcp (simulated)' }).click();
  await dialog.getByRole('button', { name: /Continue to Millennium bcp/ }).click();
  await expect(page).toHaveURL(/demo-bank/);
  await expect(page.getByRole('heading', { name: 'Millennium bcp (simulated)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve (simulated)' }).click();
  await expect(page.getByText('Bank connected. Importing transactions…')).toBeVisible();
  await expect(page.getByText('Conta à Ordem')).toHaveCount(1); // matched by identity, not duplicated
});

test('command palette jumps to a page', async ({ page }) => {
  await startDemo(page);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByRole('combobox').fill('budg');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/budgets$/);
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Search' }).getByRole('combobox').fill('netflix');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/transactions\?q=netflix/);
  await expect(page.getByText(/^[1-9]\d* transactions/)).toBeVisible();
});
