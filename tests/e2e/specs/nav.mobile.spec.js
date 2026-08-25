// nav.mobile.spec.js — the phone. Runs on the `mobile` project (a real device
// profile, not a narrowed desktop window), because `isMobile` is what the
// drawer's media queries answer to.
//
// Below 900px the nav bar has no room for its links and hides them; the drawer
// behind the burger carries the ONLY copy. That is also where search lives on a
// phone — the header trigger is hidden and `/` needs a keyboard — and a version
// of this site once shipped with `.mobile-nav .nav-search` restyled but never
// re-declaring `display`. The row rendered 0x0: no way into search on a phone at
// all, with 179 passing checks. Hence the emphasis here on things being VISIBLE
// rather than merely present.

'use strict';

const { test, expect } = require('../support/fixtures');

const drawer = (page) => page.locator('[data-mobile-nav]');
const burger = (page) => page.locator('[data-nav-toggle]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the bar collapses to a burger', async ({ page }) => {
  await expect(burger(page)).toBeVisible();
  await expect(page.locator('.nav-links')).toBeHidden();
  // Closed to begin with, and saying so.
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(drawer(page)).not.toHaveClass(/open/);
});

test('the burger opens the drawer and reports the change', async ({ page }) => {
  await burger(page).click();

  await expect(drawer(page)).toHaveClass(/open/);
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'true');

  // aria-expanded is the only thing that tells a screen reader the drawer moved.
  await burger(page).click();
  await expect(drawer(page)).not.toHaveClass(/open/);
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
});

test('the drawer carries the section links, visible and tappable', async ({ page }) => {
  await burger(page).click();

  for (const path of ['/intro/', '/docs/', '/blog/']) {
    await expect(drawer(page).locator(`a[href="${path}"]`)).toBeVisible();
  }
});

test('the drawer carries a search entry point that has a size', async ({ page }) => {
  await burger(page).click();

  const trigger = drawer(page).locator('[data-search-open]');

  await expect(trigger).toBeVisible();

  // The specific regression: present, styled, and laid out at zero.
  const box = await trigger.boundingBox();

  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
});

test('tapping search opens the dialog and closes the drawer behind it', async ({ page }) => {
  await burger(page).click();
  await drawer(page).locator('[data-search-open]').click();

  await expect(page.locator('dialog.s-dialog')).toBeVisible();
  // Otherwise the drawer is still sitting there once the dialog is dismissed.
  await expect(drawer(page)).not.toHaveClass(/open/);
});

test('following a link closes the drawer', async ({ page }) => {
  await burger(page).click();
  await drawer(page).locator('a[href="/docs/"]').click();

  await page.waitForURL('**/docs/');
  await expect(drawer(page)).not.toHaveClass(/open/);
  await expect(burger(page)).toHaveAttribute('aria-expanded', 'false');
});

test('the theme buttons in the drawer work and leave it open', async ({ page }) => {
  await burger(page).click();

  await drawer(page).locator('[data-theme-set="dark"]').click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Changing skin is something you do and then stay put — deliberately not in
  // the list of taps that dismiss the drawer.
  await expect(drawer(page)).toHaveClass(/open/);
});

test('an open drawer is not stranded when the viewport widens', async ({ page }) => {
  await burger(page).click();
  await expect(drawer(page)).toHaveClass(/open/);

  // The burger is the only control that closes it, so once the bar is wide
  // enough to hide the burger the drawer would be expanded over the desktop nav
  // with no way to dismiss it.
  await page.setViewportSize({ width: 1280, height: 900 });

  await expect(drawer(page)).not.toHaveClass(/open/);
});

test('the page does not scroll sideways', async ({ page }) => {
  // The commonest phone regression there is, and invisible to every other check.
  for (const path of ['/', '/docs/', '/blog/', '/api/', '/tutorial/user-service/']) {
    await page.goto(path);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );

    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
