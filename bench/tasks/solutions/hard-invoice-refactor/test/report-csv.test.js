'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReport } = require('../src');

const invoice = {
  number: 'C-1', customer: { name: 'A', country: 'US' }, currency: 'USD', issuedAt: '2025-01-01T00:00:00Z',
  lines: [{ sku: 'S1', description: 'Cable, 2m "black"', qty: 2, unitPrice: 4.5 }],
};

test('csv has a header, one row per line and four summary rows', () => {
  const csv = renderReport(invoice, { format: 'csv' });
  assert.equal(csv, 'sku,description,qty,unit_price,discount,net\r\nS1,"Cable, 2m ""black""",2,4.50,0.00,9.00\r\nsubtotal,,,,,9.00\r\ntax,,,,,0.00\r\nshipping,,,,,0.00\r\ntotal,,,,,9.00\r\n');
});

test('euro amounts use a decimal comma', () => {
  const text = renderReport({ ...invoice, currency: 'EUR', lines: [{ sku: 'S1', description: 'x', qty: 1, unitPrice: 1234.5 }] });
  assert.match(text, /1\.234,50 \u20ac/);
});

test('an unknown format throws RangeError', () => {
  assert.throws(() => renderReport(invoice, { format: 'pdf' }), RangeError);
});
