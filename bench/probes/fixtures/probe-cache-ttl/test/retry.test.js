'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withRetry } = require('../src/retry.js');
const { loadConfig } = require('../src/config.js');

test('retries until the call succeeds', async () => {
  const waits = [];
  let calls = 0;
  const result = await withRetry(
    () => { calls += 1; if (calls < 3) throw new Error('boom'); return 'ok'; },
    loadConfig().retry,
    async (ms) => { waits.push(ms); },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(waits, [250, 250]);
});

test('gives up after the configured attempts', async () => {
  await assert.rejects(
    withRetry(() => { throw new Error('nope'); }, { attempts: 2, delayMs: 1 }, async () => {}),
    /nope/,
  );
});
