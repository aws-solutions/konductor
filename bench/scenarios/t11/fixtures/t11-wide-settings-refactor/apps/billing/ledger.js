'use strict';

const { read } = require('../../lib');

module.exports = function buildBillingLedger() {
  const path = read("billing.ledger.path", "/ledger");
  const entries = path + '/entries';
  return { path, entries };
};
