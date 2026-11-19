const test = require('node:test');
const assert = require('node:assert/strict');
const { Ledger } = require('../src/ledger');

test('ledger records an amount once', () => {
  const ledger = new Ledger('test');
  assert.deepEqual(ledger.apply({ id: 'evt-1', amount: 40, currency: 'usd' }), { duplicate: false });
  assert.deepEqual(ledger.apply({ id: 'evt-1', amount: 40, currency: 'usd' }), { duplicate: true });
  assert.equal(ledger.snapshot().balance, 40);
});
