'use strict';

// See docs/jobs/late-fee.md.
const DAY_MS = 86400000;
const GRACE_DAYS = 30;
const SMALL_FEE = 2500;
const LARGE_FEE = 5000;
const ACCOUNT_CAP = 7500;

const utcDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

function billFee({ due, paid }, today) {
  const dueDay = utcDay(due);
  if (dueDay > today) return 0;
  const daysLate = (paid === null ? today : utcDay(paid)) - dueDay;
  if (daysLate < 1) return 0;
  return daysLate > GRACE_DAYS ? LARGE_FEE : SMALL_FEE;
}

function run({ asOf, bills }) {
  const today = utcDay(asOf);
  const raw = {};
  for (const b of bills) raw[b.accountId] = (raw[b.accountId] || 0) + billFee(b, today);
  const fees = Object.keys(raw)
    .sort()
    .map((accountId) => ({ accountId, feeCents: Math.min(ACCOUNT_CAP, raw[accountId]) }))
    .filter((f) => f.feeCents > 0);
  return { fees, totalCents: fees.reduce((n, f) => n + f.feeCents, 0) };
}

module.exports = { run };
