'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runPool } = require('../src/pool');

test('returns results in input order', async () => {
  const out = await runPool([3, 1, 2], async (n) => { await new Promise((r) => setTimeout(r, n)); return n * 2; }, 3);
  assert.deepEqual(out, [6, 2, 4]);
});

test('handles an empty list', async () => {
  assert.deepEqual(await runPool([], async () => 1, 4), []);
});
