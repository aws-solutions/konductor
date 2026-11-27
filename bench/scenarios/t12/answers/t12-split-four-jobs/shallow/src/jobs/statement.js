'use strict';

// See docs/jobs/statement.md. Shallow fake: one loose line per transaction, no columns and no total.
function run(transactions) {
  return transactions.map((t) => `${t.date} ${t.description} ${(t.amountCents / 100).toFixed(2)}`);
}

module.exports = { run };
