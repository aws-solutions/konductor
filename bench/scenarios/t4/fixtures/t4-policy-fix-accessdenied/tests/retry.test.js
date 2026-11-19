'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withRetry } = require('../src/retry');

test('retry returns after a later successful attempt', async () => {
  let count = 0;
  const value = await withRetry(async () => {
    count += 1;
    if (count < 2) throw new Error('temporary');
    return 'ok';
  });
  assert.equal(value, 'ok');
  assert.equal(count, 2);
});
