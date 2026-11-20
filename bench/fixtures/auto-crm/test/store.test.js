'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJson, writeJson } = require('../src');

// Every temp dir these tests make, removed once the file's tests are done.
const dirs = [];
test.after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(dir); return dir; };

test('writeJson then readJson round-trips and leaves no temporary file', () => {
  const dir = tempDir('crm-');
  const file = path.join(dir, 'x.json');
  writeJson(file, [{ a: 1 }]);
  assert.deepEqual(readJson(file, null), [{ a: 1 }]);
  assert.deepEqual(fs.readdirSync(dir), ['x.json']);
});

test('readJson returns the fallback for a missing file', () => {
  assert.deepEqual(readJson('/nonexistent-file.json', []), []);
});
