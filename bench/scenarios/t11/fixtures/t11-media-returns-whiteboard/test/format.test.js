'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { money, summary } = require('../src/returns/format');
test('formats cents for a staff summary', () => {
  assert.equal(money(1250), '12.50');
  assert.match(summary({ id: 'r-1', amountCents: 1250, state: 'NEW' }), /12.50/);
});
