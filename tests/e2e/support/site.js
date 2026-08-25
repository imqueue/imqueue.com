// site.js — the pages the suite asserts against, and the small helpers that would
// otherwise be copy-pasted into a dozen specs.
//
// The page list is deliberately hand-written rather than crawled: a crawl asserts
// that whatever shipped is what shipped. This names one page per FEATURE — a doc
// page with a table of contents, a paginated blog listing, an accordion, a
// generated API symbol page — so that a section quietly losing its behaviour is a
// failure rather than a smaller sitemap.

'use strict';

/** One representative page per part of the site, with what makes it that part. */
const KEY_PAGES = [
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
async function openSearch(page, how = 'button') {
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
async function searchFor(page, dialog, query) {
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
async function settle(scope, { hits = '.s-hit', quiet = 250, tries = 40 } = {}) {
  let previous = null;

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
async function internalLinks(page) {
  return page.evaluate(() =>
    Array.from(
      new Set(
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => a.href)
          .filter((href) => href.startsWith(location.origin))
          .map((href) => href.split('#')[0]),
      ),
    ),
  );
}

module.exports = { KEY_PAGES, openSearch, searchFor, settle, internalLinks };
