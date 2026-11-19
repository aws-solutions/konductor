'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runPipeline, FileStore } = require('../src');
const { tempDir, removeDir } = require('./helpers');

test('promise pipeline and store can be used together', async () => {
  const root = await tempDir();
  try {
    const input = path.join(root, 'input'); const output = path.join(root, 'output');
    await fs.mkdir(input); await fs.writeFile(path.join(input, 'one.txt'), 'one');
    const summary = await runPipeline(input, output, { concurrency: 1 });
    assert.equal(summary.processed, 1);
    const store = new FileStore();
    assert.equal((await store.readText(path.join(output, 'one.json'))).includes('one'), true);
  } finally { await removeDir(root); }
});
