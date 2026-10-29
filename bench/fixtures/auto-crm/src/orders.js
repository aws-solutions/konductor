'use strict';

const path = require('node:path');
const { readJson } = require('./store');

function ordersFor(dataDir, customerId) {
  return readJson(path.join(dataDir, 'orders.json'), []).filter((o) => o.customerId === customerId);
}

module.exports = { ordersFor };
