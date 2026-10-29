'use strict';

const { computeInvoice } = require('./calc');
const { renderText } = require('./layout-text');
const { renderCsv } = require('./layout-csv');

// Renders an invoice as a fixed-width text report (default) or as CSV.
function renderReport(invoice, options = {}) {
  const format = options.format === undefined ? 'text' : options.format;
  if (format !== 'text' && format !== 'csv') throw new RangeError(`unknown format: ${format}`);
  const calc = computeInvoice(invoice);
  return format === 'csv' ? renderCsv(calc) : renderText(invoice, calc, options.width || 72);
}

module.exports = { renderReport };
