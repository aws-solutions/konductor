'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { FileStore } = require('../src');
const { tempDir, removeDir } = require('./helpers');

test('store creates parent folders and writes JSON', async () => {
  const root = await tempDir();
  try {
    const file = path.join(root, 'nested', 'record.json'); const store = new FileStore();
    await new Promise((resolve, reject) => store.writeJson(file, { ok: true }, (err) => err ? reject(err) : resolve()));
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { ok: true });
  } finally { await removeDir(root); }
});
