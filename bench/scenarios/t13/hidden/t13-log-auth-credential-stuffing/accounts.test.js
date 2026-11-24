'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readBlock } = require('./block-kit/block-key.js');

const expected = new Set([
  'acct-0017',
  'acct-0042',
  'acct-0108',
  'acct-0231',
  'acct-0414',
  'acct-0599',
]);

test('compromised is exactly the six issued-session accounts', () => {
  const file = path.join(process.cwd(), 'analysis/2026-05-02-auth-spike.md');
  const block = readBlock(fs.readFileSync(file, 'utf8'));
  assert.ok(block, 'missing JSON block');
  assert.ok(Array.isArray(block.compromised), 'compromised must be a list');
  assert.equal(block.compromised.length, expected.size, 'unexpected compromised count');
  assert.deepEqual(new Set(block.compromised), expected);
  assert.ok(block.compromised.every((id) => !String(id).startsWith('qa-')), 'synthetic QA account listed');
});
