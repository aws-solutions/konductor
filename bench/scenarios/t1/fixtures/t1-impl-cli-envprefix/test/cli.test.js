'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommandLine } = require('../src/cli');

test('command line parser accepts repeated tags', () => {
  const result = parseCommandLine(['sync', '--tag', 'a', '--tag', 'b']);
  assert.deepEqual(result.values.tag, ['a', 'b']);
  assert.equal(result.positionals[0], 'sync');
});
