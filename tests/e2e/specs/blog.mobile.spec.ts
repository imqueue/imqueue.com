// blog.mobile.spec.ts — the blog pager on a phone. Runs on the `mobile` project.
//
// The pager shows at most seven pages and two arrows (scripts/lib/page-window.ts),
// and base.css narrows them below 480px so that row fits a phone. A pager that
// wraps onto a second line still works, which is why it is asserted here: nothing
// else would notice.

import { test, expect } from '../support/fixtures';

test('the pager stays on one row, on the widest page it can have', async ({ page }) => {
  await page.goto('/blog/');

  const numbered = page.locator('nav.pagination a').filter({ hasText: /^\d+$/ });
  const total = Number(await numbered.last().textContent());
  // a middle page shows the most slots: first, gap, three, gap, last
  const middle = Math.ceil(total / 2);

  await page.goto(middle === 1 ? '/blog/' : `/blog/page/${middle}/`);

  const tops = await page
    .locator('nav.pagination > *')
    .evaluateAll(items => items.map(item => Math.round(item.getBoundingClientRect().top)));

  expect(new Set(tops).size, `pager rows on page ${middle}`).toBe(1);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
});
