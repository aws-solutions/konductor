'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toCsv, COLUMNS } = require('../src/export');
const invoices = require('./fixtures/invoices.json');

test('header keeps the public column order', () => {
  assert.equal(toCsv([]).trim(), COLUMNS.join(','));
});

test('dates are the invoice UTC dates', () => {
  const lines = toCsv(invoices).trim().split('\n');
  assert.equal(lines[1], 'INV-3001,Harbor & Pine,2026-10-31,2026-11-30,125000,NZD');
  assert.equal(lines[2], 'INV-3002,"Moa Logistics, Ltd",2026-11-01,2026-12-01,4800,NZD');
});
