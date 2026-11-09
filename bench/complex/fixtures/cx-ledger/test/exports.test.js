'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createExports } = require('../src');

test('a statement can be read and listed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
  fs.writeFileSync(path.join(dir, 'march.csv'), 'id,cents\n1,500\n');
  const exp = createExports({ dir });
  assert.equal(await exp.readStatement('march.csv'), 'id,cents\n1,500\n');
  assert.deepEqual(await exp.listStatements(), ['march.csv']);
});
