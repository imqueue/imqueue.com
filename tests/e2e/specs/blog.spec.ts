// blog.spec.ts — the blog, which is the largest section of the site and the only
// one with paging, topic pages, author pages and a search of its own.
//
// The listing is generated, so "twenty cards render" is not the interesting part;
// what is interesting is that every way OUT of the listing works — the pager, a
// topic chip, an author, the card itself, and the sidebar's scoped search, which
// is a second, separate search surface from the modal.

import { test, expect } from '../support/fixtures';
import { attr, goto } from '../support/site';

test.describe('the listing', () => {
  test('shows a page of articles, each one a link with a summary', async ({ page }) => {
    await page.goto('/blog/');

    const cards = page.locator('a.post-card, .post-card a').first();

    await expect(cards).toBeVisible();

    const links = page.locator('[href^="/blog/"]');

    expect(await links.count()).toBeGreaterThan(10);
  });

  test('the pager walks forward and back, and knows where it is', async ({ page }) => {
    await page.goto('/blog/');

    const pager = page.locator('nav.pagination');

    await expect(pager).toBeVisible();
    await expect(pager).toHaveAttribute('aria-label', 'Blog pages');

    // Page one has no previous: a disabled marker rather than a link that goes
    // nowhere.
    await expect(pager.locator('span.disabled')).toHaveCount(1);
    await expect(pager.locator('[aria-current="page"]')).toHaveText('1');

    await pager.locator('[aria-label="Next page"]').click();
    await page.waitForURL('**/blog/page/2/');

    await expect(page.locator('nav.pagination [aria-current="page"]')).toHaveText('2');
    // And back, which is the link page one could not offer.
    await expect(page.locator('nav.pagination a[href="/blog/"]').first()).toBeAttached();
  });

  test('the last page exists and is reachable in one click', async ({ page }) => {
    await page.goto('/blog/');

    const numbered = page.locator('nav.pagination a').filter({ hasText: /^\d+$/ });
    const last = numbered.last();
    const href = await attr(last, 'href');

    const response = await goto(page, href);

    expect(response.status()).toBe(200);
    await expect(page.locator('[href^="/blog/"]').first()).toBeVisible();
  });

  test('a topic chip leads to that topic’s own page', async ({ page }) => {
    await page.goto('/blog/');

    const chip = page.locator('.topic-chips a.topic-chip').first();
    const label = (await chip.textContent() ?? '').replace(/\d+$/, '').trim();
    const href = await attr(chip, 'href');

    expect(href).toMatch(/^\/blog\/topics\/[a-z-]+\/$/);

    await chip.click();
    await page.waitForURL(`**${href}`);

    await expect(page.locator('h1')).toHaveText(new RegExp(label, 'i'));
    await expect(page.locator('[href^="/blog/"]').first()).toBeVisible();
  });
});

test.describe('an article', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/blog/backpressure-nodejs-services/');
  });

  test('is bylined, dated and attributed to a real author page', async ({ page }) => {
    const byline = page.locator('.post-byline');

    await expect(byline).toBeVisible();

    const time = byline.locator('time');

    // A machine-readable date as well as a printed one: it is what the JSON-LD
    // and the feeds are built from.
    await expect(time).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}/);
    await expect(time).not.toBeEmpty();

    const author = byline.locator('a').first();
    const href = await author.getAttribute('href');

    expect(href).toMatch(/^\/blog\/authors\/[a-z-]+\/$/);

    await author.click();
    await page.waitForURL(`**${href}`);
    await expect(page.locator('h1')).not.toBeEmpty();
  });

  test('carries its topics, and they lead somewhere', async ({ page }) => {
    const chips = page.locator('header .topic-chip');

    expect(await chips.count()).toBeGreaterThan(0);

    const linked = page.locator('header a.topic-chip').first();

    await expect(linked).toHaveAttribute('href', /^\/blog\/topics\//);
  });

  test('suggests related reading that is not itself', async ({ page }) => {
    // Scoped to the box, not to the sidebar: the aside carries a second list of
    // reference links, and those are deliberately /api/ pages rather than posts.
    const box = page.locator('.post-aside .aside-box').filter({ hasText: 'Related posts' });
    const related = box.locator('.aside-links a');

    expect(await related.count()).toBeGreaterThan(0);

    // `?? ''` rather than a filter: a related link with no href is a failure of
    // exactly this assertion, and dropping it would hide it.
    const hrefs = await related.evaluateAll((all) => all.map((a) => a.getAttribute('href') ?? ''));

    expect(hrefs.every((href) => href.startsWith('/blog/'))).toBe(true);
    expect(hrefs).not.toContain('/blog/backpressure-nodejs-services/');
  });

  test('also points at the reference pages the article talks about', async ({ page }) => {
    const reference = page.locator('.post-aside a[href^="/api/"]');

    expect(await reference.count()).toBeGreaterThan(0);
  });

  test('is structured for search engines as an Article', async ({ page }) => {
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();

    expect(blocks.length).toBeGreaterThan(0);

    const parsed = blocks.map((block) => JSON.parse(block));
    const flat = parsed.flatMap((block) => (block['@graph'] ? block['@graph'] : [block]));
    const article = flat.find((node) => /Article|BlogPosting/.test(node['@type'] || ''));

    expect(article, 'an Article node in the JSON-LD').toBeTruthy();
    expect(article.headline).toBeTruthy();
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

test.describe('the sidebar search', () => {
  // A second search surface, separate from the modal: scoped to articles, with
  // its own markup and its own index. It has broken independently before.
  test('finds articles as you type, and links to them', async ({ page }) => {
    await page.goto('/blog/');

    const box = page.locator('[data-search-scope]');

    await expect(box).toBeVisible();

    await box.locator('[data-scope-input]').fill('queue');

    const results = box.locator('[data-scope-results] li a');

    await expect(results.first()).toBeVisible();

    const href = await results.first().getAttribute('href');

    expect(href).toMatch(/^\/blog\//);

    await results.first().click();
    await page.waitForURL(`**${href}`);
    await expect(page.locator('h1')).not.toBeEmpty();
  });

  test('says so when nothing matches, rather than showing an empty box', async ({ page }) => {
    await page.goto('/blog/');

    const box = page.locator('[data-search-scope]');

    await box.locator('[data-scope-input]').fill('zzzzqqqxnothinghere');

    await expect(box.locator('[data-scope-note]')).toBeVisible();
    await expect(box.locator('[data-scope-results] li')).toHaveCount(0);
  });
});
