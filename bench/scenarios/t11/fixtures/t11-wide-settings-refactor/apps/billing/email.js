'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildBillingEmail() {
  const from = read("billing.email.from", "");
  const domain = from.split('@')[1] || 'none';
  return { from, domain };
};
