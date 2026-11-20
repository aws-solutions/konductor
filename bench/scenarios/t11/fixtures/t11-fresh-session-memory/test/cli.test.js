'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'tally.js');
const tally = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });

test('fees prints one line per invoice that owes a fee', () => {
  const r = tally('fees', '--date', '2026-11-10');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines.length >= 1);
  for (const l of lines) assert.match(l, /^INV-\d+ \S+ \d+$/);
});

test('a missing or bad date is a usage error', () => {
  assert.equal(tally('fees').status, 2);
  assert.equal(tally('fees', '--date', 'tomorrow').status, 2);
  assert.equal(tally('bill').status, 2);
});
