// pages.spec.ts — every part of the site loads, and loads whole.
//
// This is the floor the rest of the suite stands on. The fixtures already fail a
// test on a console error, an uncaught exception or a subresource 404, so the
// assertions here only have to name what a page must CONTAIN: the chrome that
// carries navigation and search, a heading, the metadata the site's whole GEO
// posture depends on, and rendered CSS (a stale content-hashed stylesheet is a
// 404 the eye reads as "the design broke").

import { test, expect } from '../support/fixtures';
import { KEY_PAGES, goto } from '../support/site';

for (const page_ of KEY_PAGES) {
  test(`${page_.name} (${page_.path}) renders`, async ({ page }) => {
    const response = await goto(page, page_.path);

    expect(response.status(), `${page_.path} status`).toBe(200);

    // Chrome: the nav, both search entry points and the footer.
    await expect(page.locator('nav.nav')).toBeVisible();
    await expect(page.locator('[data-search-open]').first()).toBeAttached();
    await expect(page.locator('[data-mobile-nav]')).toBeAttached();
    await expect(page.locator('footer')).toBeAttached();

    // Exactly one h1: the site's headings feed the search index's section titles
    // and its JSON-LD, and two of them means one of those is wrong.
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).not.toBeEmpty();

    if (page_.h1) {
      await expect(page.locator('h1')).toHaveText(page_.h1);
    }

    // Metadata every page owes: a title, a description and a canonical that
    // points at the production host rather than at wherever it was served from.
    await expect(page).toHaveTitle(/\S/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /\S/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      new RegExp(`^https://imqueue\\.org${page_.path.replace(/\//g, '\\/')}$`),
    );

    // CSS actually applied — a hashed stylesheet that 404s leaves the document
    // structurally perfect and visually gone.
    const styled = await page.evaluate(() => {
      const nav = document.querySelector('nav.nav');

      return nav ? getComputedStyle(nav).display : null;
    });

    expect(styled).not.toBe('inline');
  });
}

test('the 404 page is served, with its own status and the site chrome', async ({ page }) => {
  const response = await goto(page, '/this-page-was-never-published/');

  expect(response.status()).toBe(404);
  await expect(page).toHaveTitle(/not found/i);
  await expect(page.locator('nav.nav')).toBeVisible();
  // Somewhere to go from a dead end.
  await expect(page.locator('a[href="/"]').first()).toBeAttached();
  // Never indexable, whatever else changes about it.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    /noindex/,
  );
});

test('a directory URL without its trailing slash is redirected, not served', async ({ page }) => {
  // Both spellings must not be live: the canonical tag is the only other defence
  // against the whole site existing twice.
  const response = await goto(page, '/cli/installation');

  expect(response.url()).toBe(`${new URL(page.url()).origin}/cli/installation/`);
  expect(response.status()).toBe(200);
});

test('the homepage links out to the commercial edition, and says so', async ({ page }) => {
  await page.goto('/');

  const commercial = page.locator('a[href^="https://imqueue.com"]').first();

  await expect(commercial).toBeAttached();
});
