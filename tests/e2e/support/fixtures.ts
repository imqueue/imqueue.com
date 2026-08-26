// fixtures.ts — the shape every spec in this suite starts from.
//
// Three things every test wants, and none of them belong in the tests:
//
//   1. NOTHING LEAVES THIS MACHINE. The pages park a Google tag and a Clarity tag
//      behind consent, and the point of several tests is exactly which of them
//      wakes up. So external requests are intercepted and answered locally, and
//      the list of what was asked for becomes an assertable value.
//   2. A CONSENT DECISION ALREADY MADE. The banner is a fixed-position dialog over
//      the foot of the page; left up, it eats clicks and every unrelated spec
//      starts by dismissing it. Seeded in localStorage before the first script
//      runs, it never appears. `consent: null` opts back in to being asked.
//   3. A CLEAN CONSOLE, ASSERTED. A page that throws still renders, and the
//      failure surfaces three tests later as something inexplicable. Console
//      errors, uncaught exceptions and failed same-origin requests fail the test
//      that caused them.

// A NAMESPACE import, not a default one: @playwright/test publishes named
// exports and no default, which is what the `require()` this replaced was
// binding. `base` is kept as the name so the extension below still reads as
// "Playwright's test, plus ours".
import * as base from '@playwright/test';

/** A stored consent decision, in the shape the site's own script writes. */
interface ConsentDecision {
  analytics: boolean;
  replay: boolean;
}

/**
 * The knobs a spec turns, through `test.use({ … })`.
 *
 * These are Playwright OPTION fixtures rather than plain values, which is what
 * the `{ option: true }` second element of each tuple below declares. Naming them
 * here is what lets a spec write `test.use({ consent: null })` and be checked.
 */
interface Options {
  consent: ConsentDecision | null;
  theme: string | null;
  allowConsoleErrors: boolean;
  allowFailedRequests: (string | RegExp)[];
}

interface Fixtures extends Options {
  external: ExternalCalls;
}

/**
 * `baseURL` is optional in Playwright's types because a project need not set one.
 * This one always does — playwright.config.ts fails the run without a server — so
 * the alternative to this guard is a non-null assertion at four call sites, which
 * asserts the same thing without saying so.
 */
function requireBaseURL(baseURL: string | undefined): string {
  if (!baseURL) {
    throw new Error('fixtures: no baseURL — the project is misconfigured.');
  }

  return baseURL;
}

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const CONSENT_KEY = 'imqueue-consent';
const THEME_KEY = 'imqueue-theme';

/** Requests the browser made to anything that is not the site under test. */
class ExternalCalls {
  readonly urls: string[] = [];

  record(url: string): void {
    this.urls.push(url);
  }

  /** Every recorded URL whose host contains `needle`. */
  matching(needle: string): string[] {
    return this.urls.filter((url) => url.includes(needle));
  }

  get googleAnalytics() {
    return this.matching('googletagmanager.com').concat(
      this.matching('google-analytics.com'),
    );
  }

  get clarity() {
    return this.matching('clarity.ms');
  }
}

const test = base.test.extend<Fixtures>({
  /**
   * The consent decision to seed, or `null` to be asked (the banner shows).
   * `{ analytics: true, replay: false }` seeds a mixed decision.
   */
  consent: [{ analytics: false, replay: false }, { option: true }],

  /** Theme to seed into localStorage, or null to leave it unset ("system"). */
  theme: [null, { option: true }],

  /** Opt out of the console-error assertion for a spec that provokes one. */
  allowConsoleErrors: [false, { option: true }],

  /**
   * URL patterns whose non-OK responses are the POINT of the test.
   *
   * A subresource that 404s or 500s normally fails the test that provoked it,
   * because that is nearly always a stale asset nobody noticed. The exception is
   * a route a test has stubbed with an error on purpose — the contact form's
   * "the endpoint refused this" paths cannot be written any other way.
   */
  allowFailedRequests: [[], { option: true }],

  external: async ({}, use) => {
    await use(new ExternalCalls());
  },

  context: async ({ context, baseURL, consent, theme, external }, use) => {
    const origin = new URL(requireBaseURL(baseURL)).host;

    await context.addInitScript(
      ({ key, value, themeKey, themeValue }) => {
        // This runs before every document in the context, INCLUDING the ones a
        // test navigates to after clicking something. So `null` means "leave
        // storage alone" rather than "clear it" — a fresh context is empty
        // anyway, and clearing here would wipe the very choice a test just made
        // the moment it navigated to check the choice had survived.
        try {
          if (value !== null) {
            window.localStorage.setItem(key, value);
          }

          if (themeValue !== null) {
            window.localStorage.setItem(themeKey, themeValue);
          }
        } catch (e) {
          /* a browser with storage disabled is not what this suite is testing */
        }
      },
      {
        key: CONSENT_KEY,
        value: consent === null ? null : JSON.stringify(consent),
        themeKey: THEME_KEY,
        themeValue: theme,
      },
    );

    await context.route(
      (url) => url.host !== origin,
      async (route) => {
        const request = route.request();

        external.record(request.url());

        const type = request.resourceType();

        if (type === 'image' || /\.(png|jpe?g|gif|webp|avif|ico)$/i.test(request.url())) {
          return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 });
        }

        if (type === 'script') {
          return route.fulfill({
            status: 200,
            contentType: 'text/javascript',
            body: '/* stubbed by the e2e suite */',
          });
        }

        if (type === 'stylesheet') {
          return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
        }

        return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
      },
    );

    await use(context);
  },

  page: async ({ page, baseURL, allowConsoleErrors, allowFailedRequests }, use) => {
    const problems: string[] = [];
    const origin = new URL(requireBaseURL(baseURL)).origin;
    const expected = (url: string): boolean =>
      allowFailedRequests.some((pattern) =>
        pattern instanceof RegExp ? pattern.test(url) : url.includes(pattern),
      );

    page.on('console', (message) => {
      if (message.type() !== 'error') {
        return;
      }

      // "Failed to load resource: …" is the browser narrating a network failure
      // it has ALREADY reported through the response and requestfailed events
      // below, where the rules about what counts live — in particular that a
      // navigation to a 404 is something several tests do on purpose. Counting
      // the console copy too would make those tests fail for the thing they are
      // asserting. A real console.error from the site's own code is untouched.
      if (message.text().startsWith('Failed to load resource')) {
        return;
      }

      problems.push(`console.error: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      problems.push(`uncaught: ${error.message}`);
    });
    page.on('requestfailed', (request) => {
      // Only our own assets: an aborted external request is this suite's own doing.
      if (request.url().startsWith(origin)) {
        problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
      }
    });
    page.on('response', (response) => {
      const url = response.url();

      // A hashed asset that 404s renders a page that looks almost right. Documents
      // are excluded — several tests navigate to a 404 on purpose.
      if (
        url.startsWith(origin) &&
        response.status() >= 400 &&
        response.request().resourceType() !== 'document' &&
        !expected(url)
      ) {
        problems.push(`subresource ${response.status()}: ${url}`);
      }
    });

    await use(page);

    if (!allowConsoleErrors && problems.length) {
      throw new Error(`page reported ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
    }
  },
});

// An ESM export list re-exports BINDINGS; `expect: base.expect` is a property
// read, which only CommonJS's object literal allowed. Bound first, exported second.
const expect = base.expect;

export { test, expect, CONSENT_KEY, THEME_KEY };
