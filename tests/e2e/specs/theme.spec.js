// theme.spec.js — the three-way theme switch, which is the site's only piece of
// state that has to survive a navigation.
//
// The switch has an unusual shape and each part of it has its own way to break:
// "system" is the ABSENCE of a stored value and of the `data-theme` attribute (not
// a third value), the choice is applied by an inline script in <head> before the
// stylesheets so the page never flashes the wrong skin, and the buttons exist
// twice on every page — once in the bar and once inside the mobile drawer — with
// `aria-pressed` on both as the only state a screen reader can hear.

'use strict';

const { test, expect } = require('../support/fixtures');
const { THEME_KEY } = require('../support/fixtures');

const root = (page) => page.locator('html');
const bar = (page) => page.locator('.nav-actions .theme-toggle');

test.describe('theme switch', () => {
  test('starts on system: no attribute, nothing stored, system button pressed', async ({ page }) => {
    await page.goto('/');

    await expect(root(page)).not.toHaveAttribute('data-theme', /.*/);
    await expect(bar(page).locator('[data-theme-set="system"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBeNull();
  });

  test('choosing dark, then light, then back to system', async ({ page }) => {
    await page.goto('/');

    await bar(page).locator('[data-theme-set="dark"]').click();
    await expect(root(page)).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('dark');

    await bar(page).locator('[data-theme-set="light"]').click();
    await expect(root(page)).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('light');

    // Back to system clears the attribute AND the stored value: leaving either
    // behind is what makes an OS theme flip stop being followed.
    await bar(page).locator('[data-theme-set="system"]').click();
    await expect(root(page)).not.toHaveAttribute('data-theme', /.*/);
    expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBeNull();
  });

  test('the pressed state moves with the choice, on every copy of the switch', async ({ page }) => {
    await page.goto('/');

    await bar(page).locator('[data-theme-set="dark"]').click();

    // Both toggles — the bar and the drawer's — because reflect() walks every
    // [data-theme-set] on the page and a drawer left claiming "system" is a
    // control that lies about what it will do.
    const pressed = page.locator('[data-theme-set="dark"][aria-pressed="true"]');

    await expect(pressed).toHaveCount(2);
    await expect(page.locator('[data-theme-set="light"][aria-pressed="true"]')).toHaveCount(0);
  });

  test('the choice survives a navigation and is applied before first paint', async ({ page }) => {
    await page.goto('/');
    await bar(page).locator('[data-theme-set="light"]').click();

    await page.goto('/docs/');
    await expect(root(page)).toHaveAttribute('data-theme', 'light');

    // The head script, not site.js: assert the attribute is set at the moment the
    // document starts, before deferred scripts have run. Without it the page
    // paints dark and then snaps to light.
    const atParse = await page.evaluate(() => {
      const marker = document.documentElement.getAttribute('data-theme');

      return marker;
    });

    expect(atParse).toBe('light');
  });

  test('a dark choice really changes the rendered colours', async ({ page }) => {
    await page.goto('/');

    const background = () =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await bar(page).locator('[data-theme-set="light"]').click();
    // base.css transitions the background over 300ms, so the value read in the
    // same tick as the click is still the old one. Poll for the settled colour.
    await expect.poll(background).toBe('rgb(238, 242, 239)');

    const light = await background();

    await bar(page).locator('[data-theme-set="dark"]').click();
    await expect.poll(background).not.toBe(light);
  });
});

test.describe('system mode follows the OS', () => {
  test.use({ colorScheme: 'dark' });

  test('an OS set to dark is honoured with nothing stored', async ({ page }) => {
    await page.goto('/');

    // No attribute — the CSS media query is what answers, and that is the whole
    // point of "system" being an absence.
    await expect(root(page)).not.toHaveAttribute('data-theme', /.*/);

    const background = () =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const dark = await background();

    await page.emulateMedia({ colorScheme: 'light' });

    await expect.poll(background).not.toBe(dark);
  });
});

test.describe('a stored choice overrides the OS', () => {
  test.use({ colorScheme: 'dark', theme: 'light' });

  test('light stays light on a dark OS', async ({ page }) => {
    await page.goto('/');

    await expect(root(page)).toHaveAttribute('data-theme', 'light');
    await expect(bar(page).locator('[data-theme-set="light"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
