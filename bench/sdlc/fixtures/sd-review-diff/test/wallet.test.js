'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { transfer } = require('../src/wallet');

function memoryStore(wallets) {
  return { get: async (id) => wallets[id], set: async (id, w) => { wallets[id] = w; } };
}

test('transfer works', async () => {
  const result = await transfer(memoryStore({ a: { balance: 500 }, b: { balance: 0 } }), 'a', 'b', 200);
  assert.ok(result);
});

test('transfer refuses more than the balance', async () => {
  await assert.rejects(transfer(memoryStore({ a: { balance: 100 }, b: { balance: 0 } }), 'a', 'b', 200), /insufficient/);
});
