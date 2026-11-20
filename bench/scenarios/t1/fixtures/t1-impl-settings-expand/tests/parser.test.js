'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnv } = require('../src/parser');

test('parses comments, export prefixes, and quoted values', () => {
  assert.deepEqual(parseEnv('# heading\nexport NAME=ledger # note\nMESSAGE="hello world"\nEMPTY=', 'memory'), {
    NAME: 'ledger', MESSAGE: 'hello world', EMPTY: ''
  });
});

test('reports malformed lines with source and line', () => {
  assert.throws(() => parseEnv('OK=yes\nbad line', 'sample.env'), /sample\.env:2/);
});
