'use strict';

const { loadLedger } = require('../data/ledger');
const { formatMoney } = require('../format');
const { monthOf } = require('../dates');

module.exports = function monthlySummary(_args, { dataDir }) {
  const totals = new Map();
  for (const row of loadLedger(dataDir)) {
    const month = monthOf(row.postedAt);
    totals.set(month, (totals.get(month) ?? 0) + row.amountCents);
  }
  const lines = [...totals.keys()].sort().map((m) => `${m}  ${formatMoney(totals.get(m))}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
};
