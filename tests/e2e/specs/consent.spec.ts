// consent.spec.ts — the cookie banner, and the promise it makes.
//
// The promise is specific and testable: "nothing runs and nothing is stored
// unless you allow it". Both analytics tags ship PARKED — `<script
// type="text/plain" data-consent="…">` — and consent.js is what turns them into
// executable ones. So the assertions here are not about the banner's markup, they
// are about NETWORK TRAFFIC: which vendor was contacted, and when.
//
// Every external request is intercepted by the fixtures and answered locally
// (nothing leaves the machine), which is exactly what makes "was Google asked
// for?" an assertable value.
//
// `consent: null` = no stored decision, so the banner shows. The rest of the
// suite seeds a declined decision, which is why this is the only file that sees
// the banner at all.

import type { Page } from '@playwright/test';

import { test, expect, CONSENT_KEY } from '../support/fixtures';

test.use({ consent: null });

const banner = (page: Page) => page.locator('[data-consent-banner]');
const stored = (page: Page) =>
  page.evaluate((key: string) => window.localStorage.getItem(key), CONSENT_KEY);

/**
 * The stored decision, parsed.
 *
 * `JSON.parse(null)` is `null` at runtime but a type error, and the difference
 * matters here: several tests assert that NOTHING was stored, and they should say
 * so rather than lean on a coercion.
 */
const decision = async (page: Page): Promise<unknown> => {
  const raw = await stored(page);

  return raw === null ? null : JSON.parse(raw);
};

test.describe('before a decision', () => {
  test('the banner is shown, and no vendor has been contacted', async ({ page, external }) => {
    await page.goto('/');

    await expect(banner(page)).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/cc-open/);

    // The whole point. Not "the tag is configured not to track" — not requested.
    expect(external.googleAnalytics).toEqual([]);
    expect(external.clarity).toEqual([]);

    // Parked, not absent: the markup ships on every page and consent.js is what
    // brings it to life.
    await expect(page.locator('script[type="text/plain"][data-consent="analytics"]').first())
      .toBeAttached();
    await expect(page.locator('script[type="text/plain"][data-consent="replay"]').first())
      .toBeAttached();
  });

  test('a declining visit leaves no cookies at all', async ({ page }) => {
    await page.goto('/');

    // Including the consent decision itself, which is in localStorage precisely
    // so that "no cookies please" does not have to be recorded in a cookie.
    expect(await page.context().cookies()).toEqual([]);
  });

  test('nothing is stored until a button is pressed', async ({ page }) => {
    await page.goto('/');

    expect(await stored(page)).toBeNull();
  });
});

test.describe('declining', () => {
  test('hides the banner, records the refusal and contacts nobody', async ({ page, external }) => {
    await page.goto('/');

    await page.locator('[data-consent-action="decline"]').click();

    await expect(banner(page)).toBeHidden();
    expect(await decision(page)).toEqual({ analytics: false, replay: false });
    expect(external.googleAnalytics).toEqual([]);
    expect(external.clarity).toEqual([]);
  });

  test('is remembered, so the banner does not come back', async ({ page, external }) => {
    await page.goto('/');
    await page.locator('[data-consent-action="decline"]').click();

    await page.goto('/docs/');

    await expect(banner(page)).toBeHidden();
    expect(external.googleAnalytics).toEqual([]);
  });
});

test.describe('allowing', () => {
  test('allow all loads both vendors, immediately and without a reload', async ({ page, external }) => {
    await page.goto('/');

    await page.locator('[data-consent-action="accept"]').click();

    await expect(banner(page)).toBeHidden();
    expect(await decision(page)).toEqual({ analytics: true, replay: true });

    // The parked tags are replaced in document order, so the request goes out on
    // this page view rather than on the next one.
    await expect.poll(() => external.googleAnalytics.length).toBeGreaterThan(0);
    await expect.poll(() => external.clarity.length).toBeGreaterThan(0);
  });

  test('the decision carries to the next page without asking again', async ({ page, external }) => {
    await page.goto('/');
    await page.locator('[data-consent-action="accept"]').click();
    await expect.poll(() => external.googleAnalytics.length).toBeGreaterThan(0);

    await page.goto('/blog/');

    await expect(banner(page)).toBeHidden();
    await expect.poll(() => external.googleAnalytics.length).toBeGreaterThan(1);
  });
});

test.describe('choosing one purpose and not the other', () => {
  test('the panel opens on demand and reports its own state', async ({ page }) => {
    await page.goto('/');

    const toggle = page.locator('[data-consent-toggle]');
    const panel = page.locator('#cc-panel');

    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(panel).toBeHidden();
  });

  test('analytics on, session replay off — and only Google is contacted', async ({ page, external }) => {
    await page.goto('/');

    await page.locator('[data-consent-toggle]').click();
    await page.locator('[data-consent-cat="analytics"]').check();
    await page.locator('[data-consent-action="save"]').click();

    await expect(banner(page)).toBeHidden();
    expect(await decision(page)).toEqual({ analytics: true, replay: false });

    await expect.poll(() => external.googleAnalytics.length).toBeGreaterThan(0);
    // Given a moment in which it could have gone out, and did not.
    await page.waitForTimeout(500);
    expect(external.clarity).toEqual([]);
  });

  test('an unticked box is a refusal, not an absence', async ({ page }) => {
    await page.goto('/');

    await page.locator('[data-consent-toggle]').click();
    await page.locator('[data-consent-action="save"]').click();

    // Every category is written explicitly false, so a later visit reads a
    // decision rather than "never asked" and shows the banner again.
    expect(await decision(page)).toEqual({ analytics: false, replay: false });
  });
});

test.describe('changing your mind', () => {
  test('the footer link brings the banner back and moves focus to it', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-consent-action="decline"]').click();
    await expect(banner(page)).toBeHidden();

    await page.locator('[data-consent-open]').first().click();

    await expect(banner(page)).toBeVisible();
    // Asked for deliberately, so focus follows — unlike the unprompted banner on
    // first visit, which must not steal it.
    await expect(banner(page).locator('[data-consent-action]').first()).toBeFocused();
  });

  test('a mixed decision reopens with the panel already open', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-consent-toggle]').click();
    await page.locator('[data-consent-cat="analytics"]').check();
    await page.locator('[data-consent-action="save"]').click();

    await page.locator('[data-consent-open]').first().click();

    // The one-line summary row can say "allowed" or "declined" but cannot show
    // that one purpose is on and the other off, so the panel is opened unasked.
    await expect(page.locator('#cc-panel')).toBeVisible();
    await expect(page.locator('[data-consent-cat="analytics"]')).toBeChecked();
    await expect(page.locator('[data-consent-cat="replay"]')).not.toBeChecked();
  });

  test('withdrawing a consent that was acted on reloads the page', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-consent-action="accept"]').click();
    await expect(banner(page)).toBeHidden();

    // The vendor's script is live in this document and neither vendor offers a
    // way to unload itself, so the only honest way to stop it is a fresh one.
    const reloaded = page.waitForNavigation();

    await page.locator('[data-consent-open]').first().click();
    await page.locator('[data-consent-action="decline"]').click();
    await reloaded;

    expect(await decision(page)).toEqual({ analytics: false, replay: false });
    await expect(banner(page)).toBeHidden();
  });
});
