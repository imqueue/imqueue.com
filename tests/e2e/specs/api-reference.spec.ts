// api-reference.spec.ts — /api/, the generated reference, and the redirect policy
// that keeps its old URLs alive.
//
// Those redirects are the reason tests/e2e/server/pages-server.ts imports the
// real Cloudflare Pages Functions instead of just serving files: on the deployed
// site /api/core/2.0.1/ is resolved by lib/api-redirects.ts at request time, not
// by _redirects, and a suite that served the directory tree directly would prove
// nothing about the URLs readers and crawlers actually hold.
//
// The assertion that matters most is the last one: every 301 lands on a 200. A
// redirect into a 404 is worse than the 404 — it costs a round trip and it tells
// a crawler the page moved somewhere that is not there.

import type { APIRequestContext, APIResponse } from '@playwright/test';

import { test, expect } from '../support/fixtures';
import { goto } from '../support/site';

/** Follow nothing: the hop itself is what is under test. */
const hop = (request: APIRequestContext, url: string): Promise<APIResponse> =>
  request.get(url, { maxRedirects: 0 });

const target = (response: APIResponse): string | null => {
  const location = response.headers()['location'];

  return location ? new URL(location).pathname + new URL(location).search : null;
};

test.describe('trimming a URL down', () => {
  // What a reader does to a deep link they cannot make sense of, and what an
  // agent guesses when it knows the package but not the version scheme.
  for (const from of ['/api/core', '/api/core/']) {
    test(`${from} goes to the current version`, async ({ request }) => {
      const response = await hop(request, from);

      expect(response.status()).toBe(301);
      expect(target(response)).toBe('/api/core/latest/');
    });
  }

  test('an unknown package is left to 404 rather than invented', async ({ request }) => {
    const response = await hop(request, '/api/not-a-package/');

    expect(response.status()).toBe(404);
  });

  test('/api/contact is not treated as a package', async ({ request }) => {
    // The commercial contact endpoint lives at /api/contact. A catch-all that
    // resolved it to /api/contact/latest/ would take the form off the air, which
    // is why the Functions are mounted one level deeper — see lib/api-handler.ts.
    const response = await hop(request, '/api/contact');

    expect(target(response)).not.toBe('/api/contact/latest/');
  });
});

test.describe('retired versions', () => {
  test('a version of the current major resolves to /latest/', async ({ request }) => {
    const response = await hop(request, '/api/core/3.4.0/');

    expect(response.status()).toBe(301);
    expect(target(response)).toBe('/api/core/latest/');
  });

  test('a version of a past major resolves to that major’s archive', async ({ request }) => {
    // Not to /latest/: the symbols documented in 2.x are the ones that page has.
    const response = await hop(request, '/api/core/2.0.1/');

    expect(response.status()).toBe(301);
    expect(target(response)).toBe('/api/core/2.0.26/');
  });

  test('a major that was never published falls back to the package root', async ({ request }) => {
    const response = await hop(request, '/api/core/9.9.9/');

    expect(response.status()).toBe(301);
    expect(target(response)).toBe('/api/core/latest/');
  });

  test('a kept version tree is served, not redirected', async ({ request }) => {
    const response = await hop(request, '/api/core/2.0.26/');

    expect(response.status()).toBe(200);
  });

  test('the query string survives the hop', async ({ request }) => {
    const response = await hop(request, '/api/core/3.4.0/?utm_source=test');

    expect(target(response)).toBe('/api/core/latest/?utm_source=test');
  });
});

test.describe('renamed packages', () => {
  test('the retired slug 301s onto the current one', async ({ request }) => {
    const response = await hop(request, '/api/dd-trace/');

    expect(response.status()).toBe(301);
    expect(target(response)).toBe('/api/datadog/latest/');
  });

  test('a deep link under a retired slug keeps its tail', async ({ request }) => {
    const response = await hop(request, '/api/sequelize/');

    expect(response.status()).toBe(301);
    expect(target(response)).toBe('/api/pg-sequelize/latest/');
  });
});

test.describe('TypeDoc-era deep links', () => {
  // These URLs exist because the reference used to be published on imqueue.com
  // with a different layout, and crawlers still hold them.
  test('a class page maps to the same symbol in the same version', async ({ request }) => {
    const response = await hop(request, '/api/rpc/2.1.0/classes/IMQClient.html');

    expect(response.status()).toBe(301);
    expect(target(response)).toBe('/api/rpc/2.1.0/rpc.imqclient/');
  });

  test('TypeDoc navigation lands on the version index rather than a guess', async ({ request }) => {
    for (const from of ['/api/rpc/2.1.0/globals.html', '/api/rpc/2.1.0/modules/_index_.html']) {
      const response = await hop(request, from);

      expect(response.status(), from).toBe(301);
      expect(target(response), from).toBe('/api/rpc/2.1.0/');
    }
  });

  test('a symbol that tree never documented lands on the index, not a 404', async ({ request }) => {
    // IMQOptions is core's, not rpc's. Guessing /api/rpc/2.1.0/rpc.imqoptions/
    // would be a 301 into a 404, which shipped once.
    const response = await hop(request, '/api/rpc/2.1.0/interfaces/IMQOptions.html');

    expect(response.status()).toBe(301);
    expect(target(response)).toBe('/api/rpc/2.1.0/');
  });
});

test('no redirect lands anywhere but a 200', async ({ request }) => {
  const urls = [
    '/api/core',
    '/api/core/',
    '/api/core/3.4.0/',
    '/api/core/2.0.1/',
    '/api/core/9.9.9/',
    '/api/rpc/',
    '/api/dd-trace/',
    '/api/sequelize/',
    '/api/rpc/2.1.0/classes/IMQClient.html',
    '/api/rpc/2.1.0/globals.html',
    '/api/rpc/2.1.0/interfaces/IMQOptions.html',
  ];

  const broken = [];

  for (const url of urls) {
    const first = await hop(request, url);

    if (first.status() !== 301) {
      broken.push(`${url}: expected a 301, got ${first.status()}`);
      continue;
    }

    const to = target(first);

    if (to === null) {
      broken.push(`${url}: a 301 with no Location header`);
      continue;
    }

    const landed = await request.get(to, { maxRedirects: 0 });

    // One hop, and it arrives: a chain would multiply the cost on every crawl.
    if (landed.status() !== 200) {
      broken.push(`${url} -> ${target(first)}: ${landed.status()}`);
    }
  }

  expect(broken).toEqual([]);
});

test.describe('the reference pages themselves', () => {
  test('the index lists the packages, each behind its own disclosure', async ({ page }) => {
    await page.goto('/api/');

    const groups = page.locator('details.api-pkg-group');

    expect(await groups.count()).toBeGreaterThan(1);

    await groups.first().locator('summary').click();

    const link = groups.first().locator('.api-pkg-list a').first();

    await expect(link).toHaveAttribute('href', /^\/api\/[a-z-]+\/latest\//);
  });

  test('a symbol page carries its breadcrumbs and its signature', async ({ page }) => {
    const response = await goto(page, '/api/core/latest/core.redisqueue/');

    expect(response.status()).toBe(200);

    await expect(page.locator('nav.crumbs')).toBeVisible();
    await expect(page.locator('h1')).toContainText(/RedisQueue/i);
    // Generated reference pages are code first: a page with no code block is a
    // page whose generator produced prose and nothing else.
    await expect(page.locator('pre').first()).toBeVisible();
  });

  test('the FAQ is a page of real questions and answers', async ({ page }) => {
    await page.goto('/api/faq/');

    const questions = page.locator('.faq details');

    expect(await questions.count()).toBeGreaterThan(3);
    // Every question is addressable, because that is what search results and
    // llms.txt hand out.
    const ids = await questions.evaluateAll((all) => all.map((el) => el.id));

    expect(ids.every(Boolean)).toBe(true);
  });
});
