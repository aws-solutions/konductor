'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderInventoryTable } = require('../src/report');

test('renders a readable inventory table', () => {
  assert.equal(renderInventoryTable([
    { sku: 'A-1', name: 'Blue bin', unitPrice: 12.5, onHand: 4 }
  ]), [
    'SKU | Name | On hand | Unit price | Stock value',
    'A-1 | Blue bin | 4 | $12.50 | $50.00'
  ].join('\n'));
});

test('renders the table header for an empty inventory', () => {
  assert.equal(
    renderInventoryTable([]),
    'SKU | Name | On hand | Unit price | Stock value'
  );
});
