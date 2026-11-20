'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanupStorage } = require('../scripts/cleanup-storage');

// Every temp dir these tests make, removed once the file's tests are done.
const dirs = [];
test.after(() => { for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true }); });
const tempDir = (prefix) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); dirs.push(dir); return dir; };

test('orphaned blobs go to .trash, tmp is emptied, referenced blobs and archive stay', () => {
  const dir = tempDir('cs-');
  for (const f of ['blobs/a.txt', 'blobs/o.txt', 'tmp/u.part', 'archive/l.txt']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), f);
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify([{ id: 'd1', file: 'blobs/a.txt' }]));
  cleanupStorage(dir);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'blobs')), ['a.txt']);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.trash')), ['o.txt']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'tmp')), []);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'archive')), ['l.txt']);
});
