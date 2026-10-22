import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';

async function startDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'Demo mode' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Dashboard/ })).toBeVisible();
}

async function go(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).click();
}

async function a11y(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
}

test('demo onboarding and dashboard', async ({ page }) => {
  await startDemo(page);
  for (const t of ['Spent this month', 'Income this month', 'Net cash flow', 'Monthly budget remaining', 'Pending (not yet posted)']) await expect(page.getByRole('heading', { name: t })).toBeVisible();
  await expect(page.getByText('Needs your attention')).toBeVisible();
  await expect(page.getByText(/Bank access expired/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bank balances' })).toBeVisible();
  await expect(page.getByText('Available (interim)').first()).toBeVisible();
  await expect(page.getByText(/not your bank balance/)).toBeVisible();
  await a11y(page);
});

test('transaction search, filters and detail', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Transactions');
  await page.getByLabel('Search merchant, description or note').fill('pingo doce amoreiras');
  await expect(page.getByText(/^1 transactions/)).toBeVisible();
  await page.getByRole('button', { name: /Open Pingo Doce/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('COMPRA 4521 PINGO DOCE AMOREIRAS')).toBeVisible();
  await expect(dialog.getByText('Pending amount was')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await page.getByLabel('Search merchant, description or note').fill('');
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByLabel('Status').selectOption('pending');
  await expect(page).toHaveURL(/status=pending/);
  await expect(page.getByText(/^[1-9] transactions/)).toBeVisible();
  const items = page.locator('.txlist .tx');
  await expect(items.first()).toBeVisible();
  for (const b of await items.all()) await expect(b.locator('.badge-warn', { hasText: 'Pending' })).toBeVisible();
  await a11y(page);
});

test('category correction remembered as a rule', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Transactions');
  await page.getByLabel('Search merchant, description or note').fill('PAG SERV ENT 21025');
  await expect(page.getByText(/^6 transactions/)).toBeVisible();
  await page.getByRole('button', { name: /^Open / }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Category', { exact: true }).selectOption({ label: 'Utilities' });
  await dialog.getByLabel(/Also apply to future and past/).check();
  await expect(dialog.getByText(/transactions match; would change/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved and rule created')).toBeVisible();
  await expect(page.locator('.txlist .tx').first().getByText('Utilities')).toBeVisible();
  await go(page, 'Categories & rules');
  await expect(page.getByRole('cell', { name: /Payment to entity 21025/ })).toBeVisible();
});

test('budget setup', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Budgets');
  await expect(page.getByRole('heading', { name: 'Restaurants & cafés' })).toBeVisible();
  const total = page.locator('.budget-line').first();
  await total.getByRole('button', { name: 'Edit' }).click();
  await total.getByLabel('Monthly amount').fill('2500');
  await total.getByRole('button', { name: 'Save' }).click();
  await expect(total.getByText(/of €2,500\.00/)).toBeVisible();
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Health' });
  await page.getByLabel(/Monthly amount \(EUR\)/).fill('40');
  await page.getByRole('button', { name: 'Add category budget' }).click();
  await expect(page.getByRole('heading', { name: 'Health' })).toBeVisible();
  await expect(page.getByText(/not added on top of it/)).toBeVisible();
  await a11y(page);
});

test('recurring payment review with undo', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Recurring');
  await expect(page.getByText(/Dates and amounts are estimates/)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Fitness Hut' });
  await row.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('tab', { name: /Confirmed \(4\)/ })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('tab', { name: /Confirmed \(3\)/ })).toBeVisible();
  await a11y(page);
});

test('reports and CSV export', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Reports');
  await expect(page.getByRole('heading', { name: 'Income vs spending by month' })).toBeVisible();
  await page.getByRole('button', { name: 'Show as table' }).first().click();
  await expect(page.getByRole('table').first()).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
  const csv = fs.readFileSync((await download.path())!, 'utf8');
  expect(csv.replace(/^﻿/, '').split('\r\n')[0]).toBe('booking_date,value_date,status,account,merchant,bank_description,counterparty,amount,currency,pending_amount,type,category,category_source,excluded_from_reports,note,source');
  expect(csv).toContain('Pingo Doce');
  await a11y(page);
});

test('settings, privacy toggle, full export and deletion', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('button', { name: 'Hide amounts' }).click();
  await expect(page.locator('.tile .big').first()).toHaveText('•••••');
  await page.getByRole('button', { name: 'Show amounts' }).click();
  await go(page, 'Settings');
  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await a11y(page);
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
  await go(page, 'Dashboard');
  await expect(page.getByText('No accounts yet')).toBeVisible();
});

test('connect flow through the simulated bank reuses existing accounts', async ({ page }) => {
  await startDemo(page);
  await go(page, 'Accounts');
  await page.getByRole('button', { name: 'Connect a bank' }).click();
  await page.getByRole('button', { name: 'Millennium bcp (simulated)' }).click();
  await expect(page.getByRole('heading', { name: 'Millennium bcp (simulated)' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve (simulated)' }).click();
  await expect(page.getByText('Bank connected. Importing transactions…')).toBeVisible();
  await expect(page.getByText('Conta à Ordem')).toHaveCount(1); // matched by identity, not duplicated
});
