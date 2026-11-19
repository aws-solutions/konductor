const test = require('node:test');
const assert = require('node:assert/strict');
const { Ledger } = require('../src/ledger');

test('ledger starts empty', () => {
  assert.deepEqual(new Ledger().snapshot().eventIds, []);
});
