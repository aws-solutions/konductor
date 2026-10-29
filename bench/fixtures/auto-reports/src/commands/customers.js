'use strict';

const { loadOrders } = require('../data/orders');

module.exports = function customers(_args, { dataDir }) {
  const names = [...new Set(loadOrders(dataDir).map((o) => o.customer))].sort();
  return names.length ? `${names.join('\n')}\n` : '';
};
