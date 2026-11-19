const test = require('node:test');
const assert = require('node:assert/strict');
const { taxRateFor } = require('../src/tax/table');

test('tax table selects the current region rate', () => {
  assert.equal(taxRateFor('US', new Date('2025-03-01')), 0.075);
  assert.equal(taxRateFor('not-real', new Date('2025-03-01')), 0);
});
