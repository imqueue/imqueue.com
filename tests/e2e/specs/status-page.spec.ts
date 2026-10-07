// status-page.spec.ts — /status/ on a desktop. The phone layout restacks the tables
// (status-page.mobile.spec.ts); at full width they must stay ordinary tables, with
// their header row, because the restacking is a media query and nothing else.

import { test, expect } from '../support/fixtures';

test('the tables stay tables at full width', async ({ page }) => {
  await page.goto('/status/');

  const table = page.locator('.prose table').filter({ hasText: '@imqueue/core' });

  await expect(table.locator('thead')).toBeVisible();
  await expect(table.locator('tbody tr').first()).toHaveCSS('display', 'table-row');
});
