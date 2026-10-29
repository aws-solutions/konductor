'use strict';

// The v1 batch loop. Replaced in 1.0; kept for the migration script that was never written.
async function runBatchV1(events, handle) {
  const totals = {};
  for (const e of events) {
    await handle(e);
    totals[e.customerId] = (totals[e.customerId] || 0) + e.amountCents;
  }
  return totals;
}

module.exports = { runBatchV1 };
