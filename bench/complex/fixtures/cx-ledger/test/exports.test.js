'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExports } = require('../src');

// Every temp dir these tests make, removed once the file's tests are done.
const dirs = [];
test.after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(dir); return dir; };

test('a statement can be read and listed', async () => {
  const dir = tempDir('exp-');
  fs.writeFileSync(path.join(dir, 'march.csv'), 'id,cents\n1,500\n');
  const exp = createExports({ dir });
  assert.equal(await exp.readStatement('march.csv'), 'id,cents\n1,500\n');
  assert.deepEqual(await exp.listStatements(), ['march.csv']);
});
