'use strict';

const { computeInvoice } = require('./calc');
const { renderText } = require('./layout-text');

function renderReport(invoice, options = {}) {
  return renderText(invoice, computeInvoice(invoice), options.width || 72);
}

module.exports = { renderReport };
