'use strict';
const { withRetry } = require('./retry');

async function notifyWarehouse(http, order) {
  return withRetry(() => http.post('/warehouse/orders', order));
}

async function notifyBilling(http, order) {
  return http.post('/billing/charges', order);
}

module.exports = { notifyWarehouse, notifyBilling };
