'use strict';

// See docs/jobs/interest.md. apr becomes an integer of hundredths of a percent, so the sum never leaves integers.
const APR = /^(\d+)(?:\.(\d{1,2}))?$/;
const MONTHS = 12n;

function aprHundredths(id, apr) {
  const m = typeof apr === 'string' ? APR.exec(apr) : null;
  if (!m) throw new Error(`interest: bad apr for account ${id}: ${JSON.stringify(apr)}`);
  return BigInt(`${m[1]}${(m[2] || '').padEnd(2, '0')}`);
}

function monthlyCents(balanceCents, hundredths) {
  const den = 100n * 100n * MONTHS;
  const num = BigInt(balanceCents) * hundredths;
  const q = num / den;
  return Number(2n * (num % den) >= den ? q + 1n : q);
}

function run(accounts) {
  const rows = [];
  for (const { id, status, balanceCents, apr } of accounts) {
    if (status === 'closed') continue;
    const hundredths = aprHundredths(id, apr);
    if (balanceCents > 0) rows.push({ id, interestCents: monthlyCents(balanceCents, hundredths) });
  }
  return rows.sort((a, b) => (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));
}

module.exports = { run };
