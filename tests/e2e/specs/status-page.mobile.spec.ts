// status-page.mobile.spec.ts — /status/ on a phone. Runs on the `mobile` project.
//
// The page sets `stackTables: true`, so below 700px each table row is restacked as a
// card and every cell prints its column's name. The name comes from a `data-label`
// that scripts/lib/md-stack-tables.ts copies from the header at build time; prose.css
// only displays it. Either half failing leaves a page that looks fine at a glance — a
// table that scrolls sideways, or cards whose values have no names — so both are
// asserted, along with the ARIA roles that keep a restacked table announced as one.

import { test, expect } from '../support/fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/status/');
});

test('the page does not scroll sideways', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
});

test('package rows are stacked as cards, one per package', async ({ page }) => {
  const table = page.locator('.prose table').filter({ hasText: '@imqueue/core' });
  const rows = table.locator('tbody tr');

  await expect(table.locator('thead')).toBeHidden();
  expect(await rows.count()).toBeGreaterThan(10);
  await expect(rows.first()).toHaveCSS('display', 'block');
});

test('every value is named by its column', async ({ page }) => {
  const table = page.locator('.prose table').filter({ hasText: '@imqueue/core' });
  const headers = await table.locator('thead th').allTextContents();
  const labels = await table
    .locator('tbody tr')
    .first()
    .locator('td')
    .evaluateAll(cells => cells.map(cell => cell.getAttribute('data-label')));

  expect(labels).toEqual(headers.map(header => header.trim()));

  // the label is printed, not merely present
  const printed = await table
    .locator('tbody tr')
    .first()
    .locator('td')
    .nth(1)
    .evaluate(cell => getComputedStyle(cell, '::before').content);

  expect(printed).toBe(`"${(headers[1] ?? '').trim()}"`);
});

test('the restacked tables are still announced as tables', async ({ page }) => {
  await expect(page.getByRole('table')).toHaveCount(
    await page.locator('.prose table').count(),
  );
  await expect(page.getByRole('cell', { name: '@imqueue/core' })).toBeVisible();
});
