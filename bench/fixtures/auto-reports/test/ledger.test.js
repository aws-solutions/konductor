'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadLedger } = require('../src');

test('the ledger loader parses amounts as numbers', () => {
  const rows = loadLedger(path.join(__dirname, '..', 'data'));
  assert.equal(rows.length, 14);
  assert.deepEqual(rows[1], { id: 'L002', postedAt: '2025-01-03T09:15:00Z', orderId: 'O-1001', type: 'fee', amountCents: -380, status: 'posted' });
});

test('a missing ledger file is an empty list', () => {
  assert.deepEqual(loadLedger('/nonexistent-dir'), []);
});
