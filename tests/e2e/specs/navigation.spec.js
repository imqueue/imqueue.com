// navigation.spec.js — getting around: the bar, the breadcrumbs, the footer, and
// the two places a reader can end up that are not pages (a 404, and a link out).
//
// The link graph itself is checked exhaustively and cheaply by
// scripts/check-links.js, so this file does not re-crawl it. What it covers is
// what that check cannot see: that the links are REACHABLE and ACTED ON in a
// browser — rendered, clickable, and landing where they say.

'use strict';

const { test, expect } = require('../support/fixtures');
const { internalLinks } = require('../support/site');

test.describe('the nav bar', () => {
  test('the three section links go where they say', async ({ page }) => {
    await page.goto('/');

    for (const [label, path] of [['intro', '/intro/'], ['docs', '/docs/'], ['blog', '/blog/']]) {
      const link = page.locator(`.nav-links a:text-is("${label}")`);

      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', path);
    }

    await page.locator('.nav-links a:text-is("docs")').click();
    await page.waitForURL('**/docs/');
    await expect(page.locator('h1')).not.toBeEmpty();
  });

  test('the brand goes home from a page deep in the site', async ({ page }) => {
    await page.goto('/cli/installation/');

    // The header's copy: the footer carries a second `a.brand` for the same
    // destination, and a bare selector matches both.
    await page.locator('.nav-inner a.brand').click();
    await page.waitForURL(new RegExp(`${new URL(page.url()).origin}/$`));
    await expect(page.locator('h1')).toHaveText(/talk to your services/i);
  });

  test('the install call to action points at the published package', async ({ page }) => {
    await page.goto('/');

    const cta = page.locator('.nav-actions a[href*="npmjs.com"]');

    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', /@imqueue\/cli/);
    await expect(cta).toContainText('npm i -g @imqueue/cli');
  });
});

test.describe('breadcrumbs', () => {
  test('a nested page says where it is and links back up', async ({ page }) => {
    await page.goto('/cli/installation/');

    const crumbs = page.locator('nav.crumbs');

    await expect(crumbs).toBeVisible();
    await expect(crumbs).toHaveAttribute('aria-label', 'Breadcrumb');

    // The last crumb is the page itself and must not be a link — aria-current is
    // what says "you are here" rather than "go here".
    await expect(crumbs.locator('[aria-current="page"]')).toHaveCount(1);

    const home = crumbs.locator('a').first();

    await expect(home).toHaveAttribute('href', '/');

    // The one above the leaf, which is what a breadcrumb is FOR.
    const up = crumbs.locator('a').last();
    const target = await up.getAttribute('href');

    await up.click();
    await page.waitForURL(`**${target}`);
    await expect(page.locator('h1')).not.toBeEmpty();
  });
});

test.describe('the footer', () => {
  test('carries the legal pages, and they are real', async ({ page }) => {
    await page.goto('/');

    const footer = page.locator('footer');

    for (const path of ['/privacy/', '/terms/', '/support/', '/contact/']) {
      await expect(footer.locator(`a[href="${path}"]`).first()).toBeAttached();
    }

    const response = await page.goto('/terms/');

    expect(response.status()).toBe(200);
  });

  test('links to the commercial edition as an external site', async ({ page }) => {
    await page.goto('/');

    const commercial = page.locator('footer a[href^="https://imqueue.com"]').first();

    await expect(commercial).toBeAttached();
    // Marked as leaving, so it never reads as another page of this site.
    await expect(commercial).toContainText('↗');
  });
});

test.describe('dead ends', () => {
  test('an unknown URL gets the 404 page with a way out', async ({ page }) => {
    const response = await page.goto('/does/not/exist/');

    expect(response.status()).toBe(404);
    await expect(page.locator('h1')).toBeVisible();

    // Search is on the 404 too: not knowing the URL is exactly when it is wanted.
    await expect(page.locator('[data-search-open]').first()).toBeAttached();

    await page.locator('.nav-inner a.brand').click();
    await expect(page.locator('h1')).toHaveText(/talk to your services/i);
  });

  test('an unknown /api/ package 404s rather than inventing a version', async ({ page }) => {
    // /api/<pkg>/ resolves to /api/<pkg>/latest/ only for packages that exist;
    // guessing would send a reader to a 301 that lands on a 404.
    const response = await page.goto('/api/not-a-package/');

    expect(response.status()).toBe(404);
  });
});

test.describe('the link graph, as rendered', () => {
  test('the homepage has no link to a page that is not there', async ({ page, request }) => {
    await page.goto('/');

    const links = await internalLinks(page);

    expect(links.length).toBeGreaterThan(10);

    const broken = [];

    for (const href of links) {
      const response = await request.get(href, { maxRedirects: 5 });

      if (!response.ok()) {
        broken.push(`${href} -> ${response.status()}`);
      }
    }

    expect(broken).toEqual([]);
  });
});
