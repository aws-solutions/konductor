'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { run } = require('../src');

const dataDir = path.join(__dirname, '..', 'data');

test('list-orders prints one line per order', () => {
  const { code, out } = run(['list-orders'], { dataDir });
  assert.equal(code, 0);
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 10);
  assert.equal(lines[0], 'O-1001  ana  refunded  120.00');
});

test('customers prints the distinct names, sorted', () => {
  assert.equal(run(['customers'], { dataDir }).out, 'ana\nben\ncy\ndee\neli\n');
});

test('an unknown command is exit code 2', () => {
  const r = run(['nope'], { dataDir });
  assert.equal(r.code, 2);
  assert.match(r.out, /unknown command: nope/);
});
