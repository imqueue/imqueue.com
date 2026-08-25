// search.mobile.spec.js — search on a phone, which is a different surface from
// search on a desktop: no `/` shortcut, no header trigger, and a dialog that has
// to fit a small viewport without trapping the reader in it.

'use strict';

const { test, expect } = require('../support/fixtures');

test('the dialog fits the viewport it opened in', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-nav-toggle]').click();
  await page.locator('[data-mobile-nav] [data-search-open]').click();

  const dialog = page.locator('dialog.s-dialog');

  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();

  expect(box.width).toBeLessThanOrEqual(viewport.width);
  // A dialog wider than the screen puts the close button off it.
  await expect(dialog.locator('.s-close')).toBeVisible();
});

test('typing gives results that can be tapped', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-nav-toggle]').click();
  await page.locator('[data-mobile-nav] [data-search-open]').click();

  const dialog = page.locator('dialog.s-dialog');

  await dialog.locator('.s-input').fill('installation');
  await dialog.locator('.s-hit').first().waitFor({ state: 'visible' });

  const first = dialog.locator('.s-hit').first();
  const href = await first.getAttribute('href');
  const box = await first.boundingBox();

  // Tappable, not merely present: a 4px-high row is a link nobody can hit.
  expect(box.height).toBeGreaterThan(24);

  await first.tap();
  await page.waitForURL(`**${href.split('#')[0]}`);
  await expect(page.locator('h1')).not.toBeEmpty();
});

test('the close button is enough to get out', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-nav-toggle]').click();
  await page.locator('[data-mobile-nav] [data-search-open]').click();

  const dialog = page.locator('dialog.s-dialog');

  await expect(dialog).toBeVisible();

  // There is no Escape key on a phone, so this is the only way out.
  await dialog.locator('.s-close').tap();
  await expect(dialog).toBeHidden();
});
