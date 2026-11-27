'use strict';

// See docs/jobs/dormant.md. Dates become UTC day numbers.
const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;

function run({ asOf, accounts, transactions }) {
  const today = day(asOf);
  const active = new Set();
  for (const t of transactions) {
    const d = day(t.date);
    if (d <= today && d >= today - 89) active.add(t.accountId);
  }
  const out = new Set();
  for (const a of accounts) if (day(a.opened) < today - 90 && !active.has(a.id)) out.add(a.id);
  return [...out].sort();
}

module.exports = { run };
