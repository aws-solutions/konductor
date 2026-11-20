'use strict';

const readSetting = require('../../lib/conf').read;

module.exports = function buildInvoicePrefix() {
  const prefix = readSetting("billing.invoices.prefix", "INV-");
  const sample = prefix + '100';
  return { prefix, sample };
};
