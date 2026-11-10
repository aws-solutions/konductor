const { taxFor } = require('./tax');

function lineTotal(item) {
  return item.unitPrice * item.qty;
}

function computeTotal(invoice) {
  const subtotal = invoice.items.reduce((sum, item) => sum + lineTotal(item), 0);
  return subtotal + taxFor(subtotal, invoice.region);
}

module.exports = { computeTotal, lineTotal };
