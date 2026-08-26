// search-dialog.spec.ts — the modal search, which is the site's main way in.
//
// Search is three separable things and this file only tests the third: the ranker
// (scripts/lib/ranker.ts, measured by `npm run kpi`), the index (checked by
// check-search-index.ts) and the SURFACE — whether a reader can open it, type,
// see grouped answers, walk them with the keyboard and land on the page. Nothing
// here asserts an ordering; that is the KPI harness's job and duplicating it here
// would produce a suite that fails every time the ranker improves.

import { test, expect } from '../support/fixtures';
import { attr, openSearch, responseOf, searchFor, withoutHash } from '../support/site';

test.describe('opening and closing', () => {
  // `as const` keeps these the three literal entry points `openSearch` accepts,
  // rather than widening them to `string`.
  for (const how of ['button', 'slash', 'ctrl-k'] as const) {
    test(`opens from the ${how}`, async ({ page }) => {
      await page.goto('/');

      const dialog = await openSearch(page, how);

      await expect(dialog.locator('.s-input')).toBeFocused();
      // The modal is a real <dialog>, so the page behind it is inert — that is
      // what makes Escape and the backdrop work without any code of our own.
      await expect(page.locator('html')).toHaveClass(/s-open/);
    });
  }

  test('escape closes it and gives the page back', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/s-open/);
  });

  test('a click on the backdrop closes it, a click inside does not', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await dialog.locator('.s-bar').click();
    await expect(dialog).toBeVisible();

    // The dialog element itself IS the backdrop, so a click at the very top of
    // the viewport lands on it rather than on the form.
    await page.mouse.click(5, 5);
    await expect(dialog).toBeHidden();
  });

  test('the esc button closes it too', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await dialog.locator('.s-close').click();
    await expect(dialog).toBeHidden();
  });

  test('"/" is a shortcut only when it would otherwise be a stray keystroke', async ({ page }) => {
    await page.goto('/contact/');

    // Typing a path into a form field must type a slash, not steal the keystroke.
    const subject = page.locator('#cf-subject');

    await subject.click();
    await subject.type('/api/core/');

    await expect(page.locator('dialog.s-dialog')).toHaveCount(0);
    await expect(subject).toHaveValue('/api/core/');
  });
});

test.describe('results', () => {
  test('a symbol query returns grouped, linked results', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await searchFor(page, dialog, 'RedisQueue');

    const hits = dialog.locator('.s-hit');

    expect(await hits.count()).toBeGreaterThan(1);

    // Every group that rendered names itself, and every row is a real link with
    // a title and a breadcrumb — a row with no href is a result you cannot take.
    await expect(dialog.locator('.s-group__label').first()).not.toBeEmpty();

    const first = hits.first();

    await expect(first).toHaveAttribute('href', /^(\/|https:\/\/)/);
    await expect(first.locator('.s-hit__title')).not.toBeEmpty();
    await expect(first.locator('.s-hit__crumbs')).not.toBeEmpty();

    // The live region says how many, for a reader who cannot see the list.
    await expect(dialog.locator('.s-status')).toHaveText(/\d+\s+result/i);
  });

  test('the query is highlighted in the results', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await searchFor(page, dialog, 'RedisQueue');

    // Somewhere in the rows, not specifically in the first one's title: which
    // field carries the match depends on the ranking, and this asserts that the
    // term is marked up at all.
    //
    // A term that is present LITERALLY, deliberately. Highlighting is a substring
    // pass over the text that was scored, so a query the ranker answers through a
    // lemma or a hyphenation ("backpressure" finds "Back-pressure") correctly
    // returns the page and correctly marks nothing.
    const marked = await dialog.locator('.s-hit mark').allTextContents();

    expect(marked.length).toBeGreaterThan(0);
    expect(marked.some((text) => /redisqueue/i.test(text))).toBe(true);
  });

  test('a query nothing answers says so, without pretending to have results', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await dialog.locator('.s-input').fill('zzzzqqqxnothinghere');
    await expect(dialog.locator('.s-empty')).toBeVisible();
    await expect(dialog.locator('.s-hit')).toHaveCount(0);
    // No chip row over an empty list: a filter strip with nothing under it reads
    // as a broken control.
    await expect(dialog.locator('.s-topics')).toBeHidden();
  });

  test('an empty field shows the hint rather than every page on the site', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await expect(dialog.locator('.s-hint')).toBeVisible();
    await expect(dialog.locator('.s-hit')).toHaveCount(0);
  });

  test('a pkg: filter narrows the search', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await searchFor(page, dialog, 'pkg:rpc client');

    const hrefs = await dialog.locator('.s-hit').evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('href') ?? ''),
    );

    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => href.startsWith('/api/rpc/'))).toBe(true);
  });
});

test.describe('keyboard and navigation', () => {
  test('the first result is preselected, and Enter takes it', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await searchFor(page, dialog, 'RedisQueue');

    // Rendering highlights row one, so the shortest path through search is type,
    // Enter — no arrow keys at all.
    const first = dialog.locator('.s-hit').first();

    await expect(first).toHaveClass(/is-active/);
    await expect(first).toHaveAttribute('aria-selected', 'true');

    const target = await first.getAttribute('href');

    await page.keyboard.press('Enter');
    await page.waitForURL(`**${target}`);
    await expect(page.locator('h1')).not.toBeEmpty();
  });

  test('arrow keys walk the list, and wrap at the ends', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await searchFor(page, dialog, 'RedisQueue');

    const rows = dialog.locator('.s-hit');
    const total = await rows.count();

    expect(total).toBeGreaterThan(2);

    // Position in DOM order, which is the order the reader sees — the ids encode
    // it too, but only the DOM says what is actually on screen where.
    const activeIndex = () =>
      rows.evaluateAll((all) => all.findIndex((row) => row.classList.contains('is-active')));

    expect(await activeIndex()).toBe(0);

    await page.keyboard.press('ArrowDown');
    expect(await activeIndex()).toBe(1);

    await page.keyboard.press('ArrowDown');
    expect(await activeIndex()).toBe(2);

    // Exactly one at a time, and the combobox points at it or a screen reader
    // hears nothing move.
    await expect(dialog.locator('.s-hit.is-active')).toHaveCount(1);
    expect(await dialog.locator('.s-input').getAttribute('aria-activedescendant')).toBe(
      await rows.nth(2).getAttribute('id'),
    );

    await page.keyboard.press('ArrowUp');
    expect(await activeIndex()).toBe(1);

    // Off the top wraps to the bottom rather than sticking or losing the cursor.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect(await activeIndex()).toBe(total - 1);
  });

  test('clicking a result lands on a page that exists', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await searchFor(page, dialog, 'installation');

    const first = dialog.locator('.s-hit').first();
    const href = await attr(first, 'href');

    const [navigation] = await Promise.all([
      page.waitForNavigation(),
      first.click(),
    ]);
    const response = responseOf(navigation, href);

    expect(response.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(withoutHash(href));
  });
});

test.describe('topic filters', () => {
  test('chips count what matched and toggling one filters the list', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await searchFor(page, dialog, 'queue');

    const chips = dialog.locator('.s-topic');

    expect(await chips.count()).toBeGreaterThan(1);

    const apiChip = dialog.locator('.s-topic[data-topic="api"]');

    await expect(apiChip).toHaveAttribute('aria-pressed', 'true');

    const before = await dialog.locator('.s-hit--api').count();

    expect(before).toBeGreaterThan(0);

    await apiChip.click();

    await expect(apiChip).toHaveAttribute('aria-pressed', 'false');
    await expect(dialog.locator('.s-hit--api')).toHaveCount(0);
    // The count on a switched-off chip keeps answering "what would this give me
    // back?", so it must not fall to zero.
    await expect(apiChip.locator('.s-topic__count')).not.toHaveText('0');
  });

  test('turning every topic off explains itself instead of showing nothing', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await searchFor(page, dialog, 'queue');

    for (const chip of await dialog.locator('.s-topic').all()) {
      await chip.click();
    }

    await expect(dialog.locator('.s-empty')).toContainText(/switched off/i);
  });

  test('the per-group link carries the query on to /search/', async ({ page }) => {
    await page.goto('/');

    const dialog = await openSearch(page);

    await searchFor(page, dialog, 'queue');

    const more = dialog.locator('.s-more').first();

    await expect(more).toHaveText(/All \d+ results/);

    const href = await more.getAttribute('href');

    expect(href).toContain('/search/?q=queue');

    await more.click();
    await page.waitForURL(/\/search\/\?q=queue/);
    await expect(page.locator('[data-search-page] .s-hit').first()).toBeVisible();
  });
});

test('on /search/ the shortcut focuses the page field instead of stacking a modal', async ({ page }) => {
  await page.goto('/search/');

  await page.keyboard.press('/');

  await expect(page.locator('dialog.s-dialog')).toHaveCount(0);
  await expect(page.locator('.s-page__input')).toBeFocused();
});
