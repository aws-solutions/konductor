'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommandLine } = require('../src/cli');

test('command line parser accepts repeated tags', () => {
  const result = parseCommandLine(['sync', '--tag', 'a', '--tag', 'b']);
  assert.deepEqual(result.values.tag, ['a', 'b']);
  assert.equal(result.positionals[0], 'sync');
});

test('environment variable can be used for bucket', async () => {
  const { main } = require('../src/cli');
  const original = process.env.SYNCER_BUCKET;
  process.env.SYNCER_BUCKET = 'env-bucket';
  
  try {
    const code = await main(['list']);
    assert.equal(code, 0);
  } finally {
    if (original === undefined) delete process.env.SYNCER_BUCKET;
    else process.env.SYNCER_BUCKET = original;
  }
});
