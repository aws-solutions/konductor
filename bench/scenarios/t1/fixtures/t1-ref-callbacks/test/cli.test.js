'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../bin/sieve');

test('cli parses its stable flags', () => {
  assert.deepEqual(parseArgs(['--input', 'in', '--output', 'out', '--concurrency', '3', '--retries', '1']), { input: 'in', output: 'out', concurrency: 3, retries: 1 });
});
