'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { filesBelow } = require('../src/file-tree');

test('filesBelow returns sorted regular files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'syncer-tree-'));
  try {
    fs.mkdirSync(path.join(dir, 'b'));
    fs.writeFileSync(path.join(dir, 'z.txt'), 'z');
    fs.writeFileSync(path.join(dir, 'b', 'a.txt'), 'a');
    const found = await filesBelow(dir);
    assert.deepEqual(found.map((file) => path.relative(dir, file)), ['b/a.txt', 'z.txt']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
