'use strict';

const { loadOrders } = require('../data/orders');
const { formatMoney } = require('../format');
const { monthOf } = require('../dates');

module.exports = function monthlySummary(_args, { dataDir }) {
  const totals = new Map();
  for (const o of loadOrders(dataDir)) {
    if (o.status === 'cancelled') continue;
    const month = monthOf(o.createdAt);
    totals.set(month, (totals.get(month) ?? 0) + o.amountCents);
  }
  const lines = [...totals.keys()].sort().map((m) => `${m}  ${formatMoney(totals.get(m))}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
};
