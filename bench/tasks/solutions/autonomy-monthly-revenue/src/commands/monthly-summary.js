'use strict';

const { loadLedger } = require('../data/ledger');
const { formatMoney } = require('../format');
const { monthOf } = require('../dates');

// Net revenue per UTC month from the finance ledger: posted sales and refunds only.
module.exports = function monthlySummary(_args, { dataDir }) {
  const totals = new Map();
  for (const row of loadLedger(dataDir)) {
    if (row.status !== 'posted' || (row.type !== 'sale' && row.type !== 'refund')) continue;
    const month = monthOf(row.postedAt);
    totals.set(month, (totals.get(month) ?? 0) + row.amountCents);
  }
  const lines = [...totals.keys()].sort().map((m) => `${m}  ${formatMoney(totals.get(m))}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
};
