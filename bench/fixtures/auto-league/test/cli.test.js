'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { run } = require('../src/cli');

const dataDir = path.join(__dirname, '..', 'data');

test('stats prints a header and one line per player', () => {
  const { code, out } = run(['stats'], { dataDir });
  assert.equal(code, 0);
  const lines = out.trim().split('\n');
  assert.equal(lines.length, 6);
  assert.match(lines[0], /^player\s+played/);
});

test('an unknown command is exit code 2', () => {
  assert.equal(run(['nope'], { dataDir }).code, 2);
});
