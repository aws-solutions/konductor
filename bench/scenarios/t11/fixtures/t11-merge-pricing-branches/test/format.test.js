'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatAmount, formatQuote } = require('../src/format');

test('formats currency for a receipt', () => {
  assert.equal(formatAmount(4.5), '4.50');
  assert.equal(formatQuote({ total: 19 }), 'Total 19.00');
});
