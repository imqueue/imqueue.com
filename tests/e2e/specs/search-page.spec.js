// search-page.spec.js — /search/, the full result list.
//
// A different surface from the dialog, with different obligations: it is a URL
// somebody can be SENT. So the assertions are mostly about the address bar —
// that the query, the topic selection and the page number survive into it, come
// back out of it, and walk with the back button. A filtered list under a URL that
// claims to be unfiltered is the specific failure this guards.

'use strict';

const { test, expect } = require('../support/fixtures');
const { settle } = require('../support/site');

const results = (page) => page.locator('[data-search-page] .s-hit');

async function search(page, query) {
  await page.goto(`/search/?q=${encodeURIComponent(query)}`);
  await results(page).first().waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
  await settle(page.locator('[data-search-page]'));
}

test.describe('arriving with a query in the URL', () => {
  test('the field is seeded, the results are drawn, the title says what was asked', async ({ page }) => {
    await search(page, 'RedisQueue');

    await expect(page.locator('.s-page__input')).toHaveValue('RedisQueue');
    expect(await results(page).count()).toBeGreaterThan(1);
    await expect(page).toHaveTitle(/Search: RedisQueue/);
    await expect(page.locator('.s-page__status')).toHaveText(/\d+\s+result/i);
  });

  test('arriving with no query invites one instead of listing the site', async ({ page }) => {
    await page.goto('/search/');

    await expect(page.locator('.s-page__status')).toHaveText(/type something/i);
    await expect(results(page)).toHaveCount(0);
  });

  test('a query nothing answers says so', async ({ page }) => {
    await page.goto('/search/?q=zzzzqqqxnothinghere');

    await expect(page.locator('.s-empty')).toBeVisible();
    await expect(results(page)).toHaveCount(0);
  });
});

test.describe('submitting the form', () => {
  test('typing a new query replaces the URL and the results', async ({ page }) => {
    await search(page, 'RedisQueue');

    await page.locator('.s-page__input').fill('installation');
    await page.locator('.s-page__submit').click();

    await page.waitForURL(/[?&]q=installation/);
    await expect(results(page).first()).toBeVisible();
    await expect(page.locator('.s-page__input')).toHaveValue('installation');
  });
});

test.describe('topic filters live in the URL', () => {
  test('turning one off writes g= and pushes a history entry', async ({ page }) => {
    await search(page, 'queue');

    const chips = page.locator('.s-page__topics .s-topic');

    expect(await chips.count()).toBeGreaterThan(1);

    const api = page.locator('.s-page__topics .s-topic[data-topic="api"]');

    await expect(api).toHaveAttribute('aria-pressed', 'true');

    const before = page.url();

    await api.click();

    await page.waitForURL(/[?&]g=/);
    await expect(api).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.s-hit--api')).toHaveCount(0);

    // Pushed, not replaced: a filtered search is a place worth going back FROM,
    // and a shareable URL in its own right.
    await page.goBack();
    expect(page.url()).toBe(before);
  });

  test('a selection is carried to the next search, and the URL is corrected to say so', async ({ page }) => {
    await search(page, 'queue');

    await page.locator('.s-page__topics .s-topic[data-topic="api"]').click();
    await page.waitForURL(/[?&]g=/);

    // A bare URL, making no claim about topics. The selection carried over is a
    // better answer than silently re-showing what was just switched off...
    await page.goto('/search/?q=service');
    await results(page).first().waitFor({ state: 'visible' });

    await expect(page.locator('.s-hit--api')).toHaveCount(0);

    // ...but it must not leave a filtered list under a URL that claims to be
    // unfiltered, or copying that URL would send somebody results the sender
    // never saw. Rewritten in place — replaceState, so the back button does not
    // stop on the normalisation.
    await expect(page).toHaveURL(/[?&]g=/);
    expect(page.url()).not.toContain('api');
  });

  test('a link with g= shows the sender’s selection, not the reader’s', async ({ page }) => {
    // The URL wins when it says anything at all, so a shared link shows what the
    // sender saw whatever this session last switched off.
    await page.goto('/search/?q=queue&g=api');
    await results(page).first().waitFor({ state: 'visible' });

    await expect(page.locator('.s-page__topics .s-topic[data-topic="api"]'))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.s-page__topics .s-topic[data-topic="docs"]'))
      .toHaveAttribute('aria-pressed', 'false');

    const classes = await results(page).evaluateAll((rows) =>
      rows.map((row) => row.className),
    );

    expect(classes.every((name) => name.includes('s-hit--api'))).toBe(true);
  });

  test('every topic off explains itself and offers the way back', async ({ page }) => {
    await search(page, 'queue');

    for (const chip of await page.locator('.s-page__topics .s-topic').all()) {
      await chip.click();
    }

    // /search/ words this differently from the dialog: it knows the total, so it
    // offers the number rather than a description of the state.
    await expect(page.locator('.s-empty')).toContainText(/switch a topic back on/i);
    await expect(page.locator('.s-empty')).toContainText(/\d+ results/);
    await expect(page.locator('.s-page__status')).toHaveText(/no topics selected/i);
  });
});

test.describe('paging', () => {
  test('a long result set is paged, and the page number is in the URL', async ({ page }) => {
    // A broad query, so there is certainly more than one page of twenty.
    await search(page, 'service');

    const pager = page.locator('.s-pager');

    await expect(pager).toBeVisible();

    const shown = await results(page).count();

    expect(shown).toBeLessThanOrEqual(20);

    await pager.locator('a.s-pager__item', { hasText: 'next' }).click();
    await page.waitForURL(/[?&]page=2/);

    await expect(results(page).first()).toBeVisible();
    // A different page of results, not the same twenty under a new number.
    const second = await results(page).first().getAttribute('href');

    await page.goBack();
    await page.waitForURL(/\/search\/\?q=service$/);

    const first = await results(page).first().getAttribute('href');

    expect(second).not.toBe(first);
  });

  test('the first page offers no previous, and the pager names itself', async ({ page }) => {
    await search(page, 'service');

    const pager = page.locator('.s-pager');

    await expect(pager).toHaveAttribute('aria-label', 'Result pages');
    await expect(pager.locator('[aria-current="page"]')).toHaveText('1');

    // "prev" is rendered as a disabled span on page one, never as a link that
    // goes nowhere.
    await expect(pager.locator('span.s-pager__item.is-disabled', { hasText: 'prev' }))
      .toHaveCount(1);
    await expect(pager.locator('a.s-pager__item', { hasText: 'prev' })).toHaveCount(0);
  });
});

test('a result leads to the page it names', async ({ page }) => {
  await search(page, 'installation');

  const first = results(page).first();
  const href = await first.getAttribute('href');

  const [response] = await Promise.all([page.waitForNavigation(), first.click()]);

  expect(response.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe(href.split('#')[0]);
});
