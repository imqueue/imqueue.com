// Which page numbers a pager shows, so it stays the same size however many
// pages there are.
//
// A pager that lists every page grows by one button per five posts, and at ten
// pages it was already wider than a phone. This keeps the first and last pages,
// the current one and its neighbours, and stands a gap in for each run of
// pages it leaves out. That is at most seven slots, whatever the page count.
//
// A gap that would hide a single page shows that page instead: the number
// takes the same room as the "…", and tells the reader more.

/** A page number, or `0` where a run of pages is left out. */
export type PageSlot = number;

/**
 * The slots a pager shows.
 *
 * @param current - the page being shown, counted from 1
 * @param total - how many pages there are
 * @param siblings - how many pages to show either side of the current one
 * @returns page numbers in order, with `0` for each gap
 */
export function pageWindow(current: number, total: number, siblings = 1): PageSlot[] {
  if (!(total > 0)) return [];

  const page = Math.min(Math.max(1, Math.trunc(current)), total);
  const shown = new Set<number>([1, total]);

  for (let n = page - siblings; n <= page + siblings; n++) {
    if (n >= 1 && n <= total) shown.add(n);
  }

  const pages = [...shown].sort((a, b) => a - b);
  const slots: PageSlot[] = [];

  for (const [i, n] of pages.entries()) {
    const previous = pages[i - 1];

    if (previous !== undefined) {
      const hidden = n - previous - 1;

      if (hidden === 1) slots.push(previous + 1);
      else if (hidden > 1) slots.push(0);
    }

    slots.push(n);
  }

  return slots;
}
