'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { run } = require('../src');

test('monthly-summary prints net posted revenue per month from the ledger', () => {
  const { code, out } = run(['monthly-summary'], { dataDir: path.join(__dirname, '..', 'data') });
  assert.equal(code, 0);
  assert.equal(out, '2025-01  190.50\n2025-02  29.99\n2025-03  157.00\n2025-04  0.00\n');
});
