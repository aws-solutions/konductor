'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJson, writeJson } = require('../src');

test('writeJson then readJson round-trips and leaves no temporary file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-'));
  const file = path.join(dir, 'x.json');
  writeJson(file, [{ a: 1 }]);
  assert.deepEqual(readJson(file, null), [{ a: 1 }]);
  assert.deepEqual(fs.readdirSync(dir), ['x.json']);
});

test('readJson returns the fallback for a missing file', () => {
  assert.deepEqual(readJson('/nonexistent-file.json', []), []);
});
