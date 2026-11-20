'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runPipeline, retry, FileStore } = require('../src');
const { tempDir, removeDir } = require('./helpers');

test('runPipeline returns a promise', async () => {
  const root = await tempDir();
  try {
    const input = path.join(root, 'in');
    const output = path.join(root, 'out');
    await fs.mkdir(input);
    await fs.writeFile(path.join(input, 'test.txt'), 'hello world');
    const summary = await runPipeline(input, output, {});
    assert.equal(summary.processed, 1);
    assert.deepEqual(summary.files.map(x => x.source), ['test.txt']);
  } finally {
    await removeDir(root);
  }
});

test('retry returns a promise', async () => {
  let attempts = 0;
  const result = await retry((done) => {
    attempts += 1;
    if (attempts < 2) done(new Error('again'));
    else done(null, 'ok');
  }, { retries: 1 });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('FileStore.readText returns a promise', async () => {
  const store = new FileStore();
  const root = await tempDir();
  try {
    const file = path.join(root, 'test.txt');
    await fs.writeFile(file, 'content');
    const text = await store.readText(file);
    assert.equal(text, 'content');
  } finally {
    await removeDir(root);
  }
});
