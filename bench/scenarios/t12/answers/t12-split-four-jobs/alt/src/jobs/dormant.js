'use strict';

// See docs/jobs/dormant.md.
const DAY_MS = 86400000;
const WINDOW_DAYS = 90;

const utcDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

function run({ asOf, accounts, transactions }) {
  const today = utcDay(asOf);
  const lastSeen = new Map();
  for (const { accountId, date } of transactions) {
    const d = utcDay(date);
    if (d <= today) lastSeen.set(accountId, Math.max(d, lastSeen.get(accountId) ?? -Infinity));
  }
  const dormant = accounts.filter((a) => today - utcDay(a.opened) > WINDOW_DAYS && !(today - (lastSeen.get(a.id) ?? -Infinity) < WINDOW_DAYS));
  return [...new Set(dormant.map((a) => a.id))].sort();
}

module.exports = { run };
