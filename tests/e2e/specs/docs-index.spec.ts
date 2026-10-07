// docs-index.spec.ts — the /docs/ section grid.
//
// The grid is two columns and its card count changes whenever a section is added. With
// `grid-fill-last`, a last card that would sit alone in the left column spans both
// instead, and an even count is left alone. Both branches are asserted: today's count,
// and the other parity, made by removing a card in the page, so the rule is tested
// rather than the number of sections this site happens to have.

import { test, expect } from '../support/fixtures';

test('the grid always ends on a full row', async ({ page }) => {
  await page.goto('/docs/');

  const widths = await page.locator('.grid-fill-last').evaluate(grid => {
    const measure = () =>
      [...grid.children].map(card => Math.round(card.getBoundingClientRect().width));
    const odd = grid.children.length % 2 === 1;
    const asIs = measure();
    // flip the parity and measure again
    const last = grid.lastElementChild!;
    last.remove();
    const flipped = measure();
    grid.append(last);

    return odd ? { odd: asIs, even: flipped } : { odd: flipped, even: asIs };
  });

  const half = widths.even[0] ?? 0;

  expect(half).toBeGreaterThan(0);

  // even: every card is half width, the last one included
  expect(widths.even.every(width => width === half)).toBe(true);
  // odd: the last card spans the row, the others are unchanged
  expect(widths.odd.slice(0, -1).every(width => width === half)).toBe(true);
  expect(widths.odd.at(-1)).toBeGreaterThan(half * 1.9);
});
