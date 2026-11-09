'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLedger } = require('../src');

test('a transfer moves cents between accounts', () => {
  const ledger = createLedger({ a: 500, b: 100 });
  assert.deepEqual(ledger.transfer('a', 'b', 200), { from: 'a', to: 'b', cents: 200 });
  assert.equal(ledger.balance('a'), 300);
  assert.equal(ledger.balance('b'), 300);
});

test('a transfer larger than the balance is refused', () => {
  const ledger = createLedger({ a: 100, b: 0 });
  assert.throws(() => ledger.transfer('a', 'b', 101), { message: 'insufficient funds' });
  assert.equal(ledger.balance('a'), 100);
});
