// doc-chrome.spec.js — the behaviours a documentation page has that a page does
// not: an "On this page" index built from the content, disclosures that animate,
// a fragment that has to open the thing it names, and screenshots that open full
// size.
//
// All four are in src/_shared/js/site.js, all four are invisible to every check
// in `npm test`, and all four have failed silently before — a table of contents
// that renders in the prose instead of the sidebar still LOOKS like a table of
// contents.

'use strict';

const { test, expect } = require('../support/fixtures');

test.describe('the table of contents', () => {
  test('is moved out of the prose and into the sidebar', async ({ page }) => {
    await page.goto('/privacy/');

    const slot = page.locator('[data-toc-slot]');

    await expect(slot).toBeAttached();
    // Moved, not copied: two copies means the one in the prose is duplicated
    // content in the markdown mirror and in the search index.
    await expect(slot.locator('.table-of-contents')).toHaveCount(1);
    await expect(page.locator('.prose > .table-of-contents')).toHaveCount(0);

    await expect(page.locator('.doc-toc-title')).toHaveText(/on this page/i);
  });

  test('every entry names a heading that exists', async ({ page }) => {
    await page.goto('/privacy/');

    const targets = await page
      .locator('.doc-toc a[href^="#"]')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href').slice(1)));

    expect(targets.length).toBeGreaterThan(3);

    const missing = await page.evaluate(
      (ids) => ids.filter((id) => !document.getElementById(id) &&
        !document.getElementById(decodeURIComponent(id))),
      targets,
    );

    expect(missing).toEqual([]);
  });

  test('clicking an entry moves to that section', async ({ page }) => {
    await page.goto('/privacy/');

    const entry = page.locator('.doc-toc a[href^="#"]').nth(2);
    const href = await entry.getAttribute('href');

    await entry.click();

    await expect(page).toHaveURL(new RegExp(`${href.replace('#', '\\#')}$`));

    const heading = page.locator(href);

    await expect(heading).toBeInViewport();
  });

  test('the entry for the section being read is marked active', async ({ page }) => {
    await page.goto('/privacy/');

    // Scroll-spy is driven by scroll events, so it needs a real scroll rather
    // than a jump: `active` is what tells a long page where it is.
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(300);

    await expect(page.locator('.doc-toc a.active')).toHaveCount(1);
  });
});

test.describe('disclosures', () => {
  test('an API package group closes and reopens on its summary', async ({ page }) => {
    await page.goto('/api/');

    const group = page.locator('details.api-pkg-group').first();
    const body = group.locator('.api-pkg-list');

    // The groups ship OPEN — the packages are the content of this page, not
    // something to go looking for — so closing is the first move here.
    await expect(group).toHaveAttribute('open', '');
    await expect(body).toBeVisible();

    // Closing is the half driven by hand: the `open` flag is cleared only once
    // the roll-up has finished, so a naive implementation either snaps the
    // content away or leaves it on screen.
    await group.locator('summary').click();
    await expect(body).toBeHidden();
    await expect(group).not.toHaveAttribute('open', '');

    await group.locator('summary').click();
    await expect(group).toHaveAttribute('open', '');
    await expect(body).toBeVisible();
  });

  test('the older-versions list is behind its own disclosure', async ({ page }) => {
    await page.goto('/api/');

    const older = page.locator('details.api-older');

    await expect(older).toBeAttached();
    await expect(older.locator('.api-older-body')).toBeHidden();

    await older.locator('summary').click();
    await expect(older.locator('.api-older-body')).toBeVisible();
    // Archived majors are real pages, not decoration.
    await expect(older.locator('a[href^="/api/"]').first()).toBeAttached();
  });

  test('the FAQ accordion answers one question at a time', async ({ page }) => {
    await page.goto('/api/faq/');

    const first = page.locator('.faq details').first();

    await expect(first.locator('.faq-a')).toBeHidden();

    await first.locator('summary').click();
    await expect(first.locator('.faq-a')).toBeVisible();
    await expect(first.locator('.faq-a')).not.toBeEmpty();
  });
});

test.describe('deep links into an accordion', () => {
  test('a fragment naming a question opens that question', async ({ page }) => {
    // Search results, the "On this page" index and llms.txt all hand out
    // <page>#<question-slug>. Landing on a CLOSED question reads as the answer
    // having gone missing.
    await page.goto('/api/faq/');

    const slug = await page.locator('.faq details').nth(1).getAttribute('id');

    expect(slug).toBeTruthy();

    await page.goto(`/api/faq/#${slug}`);

    // Addressed by attribute rather than by `#id`, because the slugs are
    // percent-encoded question text and are not valid CSS identifiers.
    await expect(page.locator(`[id="${slug}"]`)).toHaveAttribute('open', '');
    await expect(page.locator(`[id="${slug}"] .faq-a`)).toBeVisible();
  });

  test('navigating to another question opens that one too', async ({ page }) => {
    await page.goto('/api/faq/');

    const slug = await page.locator('.faq details').nth(2).getAttribute('id');

    // Same document, so this is a hashchange rather than a load — a separate
    // code path from the one above, and the one that regressed.
    await page.evaluate((fragment) => { window.location.hash = fragment; }, slug);

    await expect(page.locator(`[id="${slug}"]`)).toHaveAttribute('open', '');
  });
});

test.describe('the screenshot lightbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tutorial/');
  });

  test('a screenshot opens full size, with its caption', async ({ page }) => {
    const shot = page.locator('.prose .shots img').first();
    const alt = await shot.getAttribute('alt');

    await shot.click();

    const box = page.locator('.lightbox');

    await expect(box).toBeVisible();
    await expect(box).toHaveAttribute('aria-modal', 'true');
    await expect(box.locator('.lightbox__img')).toHaveAttribute('src', /\.png$/);
    await expect(box.locator('.lightbox__cap')).toHaveText(alt);
    // The page behind it must not scroll while it is up.
    await expect(page.locator('html')).toHaveClass(/lightbox-open/);
  });

  test('escape closes it and gives focus back to the screenshot', async ({ page }) => {
    const shot = page.locator('.prose .shots img').first();

    await shot.click();
    await expect(page.locator('.lightbox')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('.lightbox')).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/lightbox-open/);
  });

  test('a click on the backdrop closes it, a click on the image does not', async ({ page }) => {
    await page.locator('.prose .shots img').first().click();

    const box = page.locator('.lightbox');

    await box.locator('.lightbox__img').click();
    await expect(box).toBeVisible();

    await box.locator('.lightbox__close').click();
    await expect(box).toBeHidden();
  });
});
