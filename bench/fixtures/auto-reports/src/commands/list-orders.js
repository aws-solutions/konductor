'use strict';

const { loadOrders } = require('../data/orders');
const { formatMoney } = require('../format');

module.exports = function listOrders(_args, { dataDir }) {
  const lines = loadOrders(dataDir).map((o) => `${o.id}  ${o.customer}  ${o.status}  ${formatMoney(o.amountCents)}`);
  return lines.length ? `${lines.join('\n')}\n` : '';
};
