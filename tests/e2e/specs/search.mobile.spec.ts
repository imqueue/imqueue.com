// search.mobile.spec.ts — search on a phone, which is a different surface from
// search on a desktop: no `/` shortcut, no header trigger, and a dialog that has
// to fit a small viewport without trapping the reader in it.

import { test, expect } from '../support/fixtures';
import { attr, settle, withoutHash } from '../support/site';

test('the dialog fits the viewport it opened in', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-nav-toggle]').click();
  await page.locator('[data-mobile-nav] [data-search-open]').click();

  const dialog = page.locator('dialog.s-dialog');

  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();

  expect(box, 'the dialog is laid out').not.toBeNull();
  expect(viewport, 'the mobile project sets a viewport size').not.toBeNull();
  expect(box?.width).toBeLessThanOrEqual(viewport?.width ?? 0);
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

  // The index arrives in TIERS, and a later tier re-runs the query and rebuilds the
  // list. Between reading the first row's href and tapping it, that rebuild can put a
  // different page in the first row — so the tap lands somewhere the assertion below
  // is not waiting for. Seen once, as a lone mobile failure in an otherwise green run.
  await settle(dialog);

  const first = dialog.locator('.s-hit').first();
  const href = await attr(first, 'href');
  const box = await first.boundingBox();

  // Tappable, not merely present: a 4px-high row is a link nobody can hit.
  expect(box, 'the first hit is laid out').not.toBeNull();
  expect(box?.height).toBeGreaterThan(24);

  await first.tap();
  await page.waitForURL(`**${withoutHash(href)}`);
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
