'use strict';

// Runs worker(item, index) for every item with at most `concurrency` calls in flight.
// Results are returned in input order.
async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

module.exports = { runPool };
