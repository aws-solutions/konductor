'use strict';

// See docs/jobs/late-fee.md.
const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const CAP = 7500;

function feeOf(bill, today) {
  const due = day(bill.due);
  if (due > today) return 0;
  const late = (bill.paid ? day(bill.paid) : today) - due;
  if (late <= 0) return 0;
  return late <= 30 ? 2500 : 5000;
}

function run({ asOf, bills }) {
  const today = day(asOf);
  const by = new Map();
  for (const b of bills) by.set(b.accountId, Math.min(CAP, (by.get(b.accountId) ?? 0) + feeOf(b, today)));
  const fees = [...by].filter(([, f]) => f > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([accountId, feeCents]) => ({ accountId, feeCents }));
  return { fees, totalCents: fees.reduce((s, f) => s + f.feeCents, 0) };
}

module.exports = { run };
