// agent-surfaces.spec.js — everything the site publishes for machines rather
// than for readers: llms.txt, the plain-markdown mirrors, the sitemaps, robots,
// the symbol index and the status feed.
//
// This is the half of the site with no HTML and no JavaScript, so it is checked
// at the HTTP level: no browser is started for this file at all.
//
// Two of the assertions are about HEADERS produced by functions/_middleware.js,
// which is why the harness runs the real middleware rather than serving files:
//
//   * `Link: <…index.md>; rel="alternate"` — the mirror, advertised to clients
//     that only make a HEAD request.
//   * `x-agent-analytics` — the edge saying out loud what it decided about a
//     request, which is the only way to tell "never measured" from "measured and
//     rejected" without a dashboard.
//
// One thing deliberately NOT asserted: the Cache-Control values in _headers.
// Those are applied by Cloudflare, not by the origin, so a local assertion would
// be testing the test harness.

'use strict';

const { test, expect } = require('../support/fixtures');

test.describe('llms.txt', () => {
  test('is served as plain text and describes the project', async ({ request }) => {
    const response = await request.get('/llms.txt');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');

    const body = await response.text();

    expect(body).toMatch(/^# @imqueue/);
    // The one-line summary an assistant quotes, in the position the convention
    // puts it.
    expect(body).toMatch(/^> /m);
    expect(body).toContain('https://imqueue.org');
  });

  test('every page it lists is real', async ({ request }) => {
    const body = await (await request.get('/llms.txt')).text();

    const paths = [
      ...new Set(
        Array.from(body.matchAll(/https:\/\/imqueue\.org(\/[^\s)]*)/g)).map((m) => m[1]),
      ),
    ];

    expect(paths.length).toBeGreaterThan(10);

    const broken = [];

    for (const path of paths) {
      const response = await request.get(path, { maxRedirects: 5 });

      if (!response.ok()) {
        broken.push(`${path} -> ${response.status()}`);
      }
    }

    expect(broken).toEqual([]);
  });

  test('llms-full.txt carries the concatenated corpus', async ({ request }) => {
    const response = await request.get('/llms-full.txt');

    expect(response.status()).toBe(200);

    const body = await response.text();

    // Much larger than the index, or it is not the full text of anything.
    expect(body.length).toBeGreaterThan(100_000);
  });
});

test.describe('the markdown mirrors', () => {
  test('a page is published at both mirror spellings, byte-identical', async ({ request }) => {
    const nested = await request.get('/cli/installation/index.md');
    const flat = await request.get('/cli/installation.md');

    expect(nested.status()).toBe(200);
    expect(flat.status()).toBe(200);
    expect(nested.headers()['content-type']).toContain('text/markdown');

    // llms.txt promises both spellings and promises they are the same file.
    expect(await flat.text()).toBe(await nested.text());
  });

  test('a mirror is markdown, and says where it came from', async ({ request }) => {
    const body = await (await request.get('/cli/installation/index.md')).text();

    expect(body).toMatch(/^# /);
    expect(body).toContain('https://imqueue.org/cli/installation/');
    // No HTML chrome: the whole point is the token cost.
    expect(body).not.toContain('<nav');
    expect(body.length).toBeLessThan(30_000);
  });

  test('an HTML page advertises its mirror in a header', async ({ request }) => {
    const response = await request.get('/cli/installation/');

    expect(response.headers()['link']).toContain('/cli/installation/index.md');
    expect(response.headers()['link']).toContain('rel="alternate"');
    expect(response.headers()['link']).toContain('type="text/markdown"');
  });

  test('a page with no mirror advertises none', async ({ request }) => {
    // Paginated blog listings are excluded on purpose: /blog/index.md already
    // lists every article, which is what an agent wants in one fetch.
    const response = await request.get('/blog/page/2/');

    expect(response.status()).toBe(200);
    expect(response.headers()['link'] || '').not.toContain('index.md');
  });

  test('a 404 never advertises a mirror', async ({ request }) => {
    const response = await request.get('/no-such-page/');

    expect(response.status()).toBe(404);
    expect(response.headers()['link'] || '').not.toContain('index.md');
  });
});

test.describe('the edge analytics diagnostic', () => {
  test('an agent surface reports its own state', async ({ request }) => {
    const response = await request.get('/llms.txt');

    // Unconfigured locally, which is itself the useful answer: the header is
    // always present on an agent surface, so a deployment can be validated with
    // one curl instead of a dashboard.
    expect(response.headers()['x-agent-analytics']).toBe('off reason=not-configured');
  });

  test('an ordinary asset is not measured here at all', async ({ request }) => {
    // Pages, CSS, fonts and images are the bulk of the traffic and skip the
    // Response rebuild entirely.
    //
    // The stylesheet is read out of the page rather than named: the filenames are
    // content-hashed, so a literal one here would be a test that fails on the
    // next CSS edit for a reason that has nothing to do with what it asserts.
    const html = await (await request.get('/')).text();
    const css = /href="(\/css\/[^"]+\.css)"/.exec(html);

    expect(css, 'a stylesheet link on the homepage').toBeTruthy();

    const response = await request.get(css[1]);

    expect(response.status()).toBe(200);
    expect(response.headers()['x-agent-analytics']).toBeUndefined();
  });
});

test.describe('sitemaps and robots', () => {
  test('the sitemap is an index of the three buckets, and each one parses', async ({ request }) => {
    const index = await request.get('/sitemap.xml');

    expect(index.status()).toBe(200);
    expect(index.headers()['content-type']).toContain('xml');

    const body = await index.text();
    const buckets = Array.from(body.matchAll(/<loc>https:\/\/imqueue\.org(\/[^<]+)<\/loc>/g))
      .map((m) => m[1]);

    expect(buckets).toEqual(
      expect.arrayContaining(['/sitemap-pages.xml', '/sitemap-blog.xml', '/sitemap-api.xml']),
    );

    for (const bucket of buckets) {
      const response = await request.get(bucket);

      expect(response.status(), bucket).toBe(200);

      const xml = await response.text();

      expect(xml, bucket).toContain('<urlset');
      expect((xml.match(/<url>/g) || []).length, bucket).toBeGreaterThan(0);
    }
  });

  test('robots welcomes the AI crawlers by name and points at llms.txt', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();

    expect(body).toMatch(/User-agent: \*/);
    expect(body).toMatch(/^Allow: \/$/m);

    for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User']) {
      expect(body, bot).toContain(`User-agent: ${bot}`);
    }

    expect(body).toContain('/llms.txt');
  });
});

test.describe('machine-readable feeds', () => {
  test('the symbol index is JSON an agent can search', async ({ request }) => {
    const response = await request.get('/api/search-index.json');

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body).toBeTruthy();
    expect(JSON.stringify(body).length).toBeGreaterThan(1000);
  });

  test('the package status feed parses and names its source', async ({ request }) => {
    const response = await request.get('/status.json');

    expect(response.status()).toBe(200);

    const body = await response.json();

    expect(body.about).toBe('https://imqueue.org/status/');
    expect(body.source).toContain('registry.npmjs.org');
    expect(body.generated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('the context7 descriptor is valid JSON', async ({ request }) => {
    const response = await request.get('/context7.json');

    expect(response.status()).toBe(200);
    expect(await response.json()).toBeTruthy();
  });

  test('the search index the browser uses is served whole', async ({ request }) => {
    for (const path of ['/search-index.json', '/search-text.json', '/search-sections.json']) {
      const response = await request.get(path);

      expect(response.status(), path).toBe(200);
      expect(await response.json(), path).toBeTruthy();
    }
  });
});
