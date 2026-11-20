'use strict';

const { lineTotal } = require('./pricing');

function renderInventoryTable(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('Items must be an array');
  }

  const rows = items.map((item) => [
    item.sku,
    item.name,
    String(item.onHand),
    `$${item.unitPrice.toFixed(2)}`,
    `$${lineTotal(item.unitPrice, item.onHand).toFixed(2)}`
  ].join(' | '));

  return [
    'SKU | Name | On hand | Unit price | Stock value',
    ...rows
  ].join('\n');
}

module.exports = { renderInventoryTable };
