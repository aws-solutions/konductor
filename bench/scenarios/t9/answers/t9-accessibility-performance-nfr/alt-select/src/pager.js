// How many rows of a result list are on screen. The page shows PAGE_SIZE rows
// first and PAGE_SIZE more each time the user asks.
export const PAGE_SIZE = 50;

export function createPager(size = PAGE_SIZE) {
  let total = 0;
  let shown = 0;
  return {
    reset(count) {
      total = count;
      shown = Math.min(size, count);
      return shown;
    },
    more() {
      const before = shown;
      shown = Math.min(shown + size, total);
      return [before, shown];
    },
    get shown() { return shown; },
    get total() { return total; },
    get hasMore() { return shown < total; },
  };
}
