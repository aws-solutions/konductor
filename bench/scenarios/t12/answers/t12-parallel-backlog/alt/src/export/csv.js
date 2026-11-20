'use strict';

const { FIELDS, validate } = require('../models/invoice');
const config = require('../config');

// The public column order: the model fields as before, then currency as the one new last column (A2, announced to
// customers on 2026-10-15). Kept apart from FIELDS so a later model field cannot move the CSV columns.
const COLUMNS = [...FIELDS.filter((f) => f !== 'currency'), 'currency'];

function toCsv(invoices) {
  const d = config.get('export.delimiter', ',');
  const rows = invoices.map(validate).map((inv) => COLUMNS.map((c) => inv[c]).join(d));
  return [COLUMNS.join(d), ...rows].join('\n') + '\n';
}

module.exports = { toCsv, COLUMNS };
