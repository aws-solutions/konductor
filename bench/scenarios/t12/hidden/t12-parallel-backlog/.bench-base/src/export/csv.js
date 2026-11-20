'use strict';

const { FIELDS, validate } = require('../models/invoice');
const config = require('../config');

function toCsv(invoices) {
  const d = config.get('export.delimiter', ',');
  return [FIELDS.join(d), ...invoices.map(validate).map((inv) => FIELDS.map((f) => inv[f]).join(d))].join('\n') + '\n';
}

module.exports = { toCsv };
