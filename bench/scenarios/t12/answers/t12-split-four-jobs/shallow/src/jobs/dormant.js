'use strict';

// See docs/jobs/dormant.md. Shallow fake: an account with no transaction at all is dormant; dates are not read.
function run({ accounts, transactions }) {
  const seen = new Set(transactions.map((t) => t.accountId));
  return accounts.filter((a) => !seen.has(a.id)).map((a) => a.id);
}

module.exports = { run };
