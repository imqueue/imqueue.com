// site.ts — the pages the suite asserts against, and the small helpers that would
// otherwise be copy-pasted into a dozen specs.
//
// The page list is deliberately hand-written rather than crawled: a crawl asserts
// that whatever shipped is what shipped. This names one page per FEATURE — a doc
// page with a table of contents, a paginated blog listing, an accordion, a
// generated API symbol page — so that a section quietly losing its behaviour is a
// failure rather than a smaller sitemap.

import type { Locator, Page, Response } from '@playwright/test';

/** A page the suite visits, and — where there is one — the mark that identifies it. */
interface KeyPage {
  path: string;
  name: string;
  h1?: RegExp;
}

/** How the search dialog can be opened. Each is a separate code path in the site. */
type SearchEntryPoint = 'button' | 'slash' | 'ctrl-k';

/** One representative page per part of the site, with what makes it that part. */
const KEY_PAGES: KeyPage[] = [
  { path: '/', name: 'home', h1: /talk to your services/i },
  { path: '/intro/', name: 'intro' },
  { path: '/get-started/', name: 'get started' },
  { path: '/docs/', name: 'docs index' },
  { path: '/cli/', name: 'CLI index' },
  { path: '/cli/installation/', name: 'CLI installation' },
  { path: '/mcp/', name: 'MCP index' },
  { path: '/mcp/tools/', name: 'MCP tools' },
  { path: '/agents/', name: 'agents' },
  { path: '/tutorial/', name: 'tutorial index' },
  { path: '/tutorial/user-service/', name: 'tutorial chapter' },
  { path: '/blog/', name: 'blog index' },
  { path: '/api/', name: 'API index' },
  { path: '/api/faq/', name: 'API FAQ' },
  { path: '/glossary/', name: 'glossary' },
  { path: '/compare/', name: 'compare' },
  { path: '/status/', name: 'status' },
  { path: '/support/', name: 'support' },
  { path: '/contact/', name: 'contact' },
  { path: '/privacy/', name: 'privacy' },
  { path: '/terms/', name: 'terms' },
  { path: '/license/', name: 'license' },
  { path: '/contributing/', name: 'contributing' },
  { path: '/using-ai-assistants/', name: 'using AI assistants' },
  { path: '/search/', name: 'search' },
];

/**
 * Open the search dialog and wait for it to be usable.
 *
 * `how` is the entry point to use, because they are three separate code paths and
 * each one has been the broken one at some point: the header button, the `/`
 * shortcut and Ctrl+K.
 */
async function openSearch(page: Page, how: SearchEntryPoint = 'button'): Promise<Locator> {
  if (how === 'button') {
    await page.locator('.nav-actions [data-search-open]').click();
  } else if (how === 'slash') {
    await page.keyboard.press('/');
  } else if (how === 'ctrl-k') {
    await page.keyboard.press('Control+k');
  } else {
    throw new Error(`unknown search entry point: ${how}`);
  }

  const dialog = page.locator('dialog.s-dialog');

  await dialog.waitFor({ state: 'visible' });

  return dialog;
}

/**
 * Type a query into the open dialog and wait for the ranker to answer.
 *
 * The input is debounced by 110ms and the index is fetched on first use, so
 * "results are on screen" is the only reliable signal — not a timeout.
 */
async function searchFor(page: Page, dialog: Locator, query: string): Promise<void> {
  await dialog.locator('.s-input').fill(query);
  await dialog.locator('.s-hit').first().waitFor({ state: 'visible' });

  // The index arrives in TIERS: the first rows can be on screen from tier 1 while
  // a later tier is still downloading, and its arrival re-runs the query and
  // rebuilds the list — which resets the keyboard cursor to "nothing selected".
  // A test that pressed ArrowDown twice across that boundary would land on the
  // first row rather than the second, intermittently.
  //
  // BOTH waits are needed, and neither alone is enough. A quiet network says the
  // later tiers have arrived but not that the re-render they cause has happened;
  // a stable list of hrefs says the DOM has stopped moving but would be satisfied
  // by a re-render that produced the same rows — which is the common case, and
  // exactly the one that silently resets the cursor.
  await page.waitForLoadState('networkidle');
  await settle(dialog);
}

/**
 * Wait until a result list has stopped being rebuilt.
 *
 * "Two identical readings in a row" rather than a network condition: the tiers
 * are fetched, but the re-render they cause is asynchronous to them, and a quiet
 * network is not yet a quiet DOM.
 */
async function settle(
  scope: Locator,
  { hits = '.s-hit', quiet = 250, tries = 40 }: { hits?: string; quiet?: number; tries?: number } = {},
): Promise<void> {
  let previous: string | null = null;

  for (let i = 0; i < tries; i++) {
    const snapshot = await scope.locator(hits).evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('href')).join('|'),
    );

    if (snapshot && snapshot === previous) {
      return;
    }

    previous = snapshot;
    await scope.page().waitForTimeout(quiet);
  }

  throw new Error('the result list never stopped changing');
}

/** Every same-origin href on the page, de-duplicated and fragment-free. */
async function internalLinks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      new Set(
        // `querySelectorAll<HTMLAnchorElement>`, not a plain one: `a[href]` is a
        // string to the DOM, so `.href` — the RESOLVED absolute URL the two lines
        // below depend on — is not on the Element the untyped call returns.
        Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
          .map((a) => a.href)
          .filter((href) => href.startsWith(location.origin))
          .map((href) => href.replace(/#.*$/, '')),
      ),
    ),
  );
}

/**
 * `page.goto` with the null case turned into a failure rather than a `?.`.
 *
 * Playwright answers null when a navigation produced no document response — an
 * in-page anchor, a download, a redirect to about:blank. Every navigation in this
 * suite expects a real page, and the specs then read `.status()` off it: a `?.`
 * there would turn "the server never answered" into an assertion that quietly
 * compares `undefined` to 200 and fails for the wrong reason.
 */
async function goto(
  page: Page,
  url: string,
  options?: Parameters<Page['goto']>[1],
): Promise<Response> {
  return responseOf(await page.goto(url, options), url);
}

/** The other half of the above, for `waitForNavigation` and friends. */
function responseOf(response: Response | null, what: string): Response {
  if (!response) {
    throw new Error(`${what}: the navigation produced no response`);
  }

  return response;
}

/**
 * An attribute that has to be there, as a string.
 *
 * `getAttribute` answers null for "no such attribute", and every caller here is
 * reading one the markup is asserted to have — a link's href, a details element's
 * id. Failing here names the missing attribute; the alternative, `?? ''`, pushes
 * the absence into the assertion below it, where "no href" and "the wrong href"
 * become the same failure message.
 */
async function attr(locator: Locator, name: string): Promise<string> {
  const value = await locator.getAttribute(name);

  if (value === null) {
    throw new Error(`expected a "${name}" attribute, and there was none`);
  }

  return value;
}

/** A URL with any fragment removed. */
const withoutHash = (url: string): string => url.replace(/#.*$/, '');

export {
  KEY_PAGES,
  openSearch,
  searchFor,
  settle,
  internalLinks,
  goto,
  responseOf,
  attr,
  withoutHash,
};
