'use strict';

const { withDefaults } = require('./config');
const { runPool } = require('./pool');
const { withRetry } = require('./retry');
const { createDedupeStore } = require('./dedupe');
const { createAggregator } = require('./aggregate');
const { sleep } = require('./sleep');

async function runBatch(events, options = {}) {
  const opts = withDefaults(options);
  const dedupe = opts.dedupe ?? createDedupeStore({ clock: opts.clock });
  const agg = createAggregator();
  const pause = opts.sleep ?? sleep;

  const outcomes = await runPool(events, async (event) => {
    if (dedupe.has(event.id)) return { duplicate: true };
    const r = await withRetry((attempt) => opts.handle(event, attempt), {
      maxRetries: opts.maxRetries, delayMs: opts.retryDelayMs, sleep: pause,
    });
    if (r.ok) {
      dedupe.mark(event.id);
      agg.add(event);
    }
    return r;
  }, opts.concurrency);

  const failed = [];
  let processed = 0;
  let duplicates = 0;
  outcomes.forEach((o, i) => {
    if (o.duplicate) duplicates += 1;
    else if (o.ok) processed += 1;
    else failed.push({ id: events[i].id, attempts: o.attempts, message: String(o.error?.message ?? o.error) });
  });
  return { totals: agg.totals(), processed, duplicates, failed };
}

module.exports = { runBatch };
