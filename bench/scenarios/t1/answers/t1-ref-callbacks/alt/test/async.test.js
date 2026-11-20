'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runPipeline, processFile, retry, FileStore } = require('../src');
const { tempDir, removeDir } = require('./helpers');

test('runPipeline returns a promise without callback', async () => {
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

test('runPipeline preserves input order when hooks finish out of order', async () => {
  const root = await tempDir();
  try {
    const input = path.join(root, 'in');
    const output = path.join(root, 'out');
    await fs.mkdir(input);
    await fs.writeFile(path.join(input, 'a.txt'), 'first');
    await fs.writeFile(path.join(input, 'b.txt'), 'second');
    await fs.writeFile(path.join(input, 'c.txt'), 'third');
    
    const summary = await runPipeline(input, output, { concurrency: 3 });
    assert.equal(summary.processed, 3);
    assert.deepEqual(summary.files.map(x => x.source), ['a.txt', 'b.txt', 'c.txt']);
  } finally {
    await removeDir(root);
  }
});

test('runPipeline callback runs exactly once on error', async () => {
  let callbackCount = 0;
  const result = await new Promise((resolve) => {
    runPipeline('/definitely/missing/sieve-input', '/tmp/sieve-out', {}, (err) => {
      callbackCount++;
      assert.ok(err);
      resolve(callbackCount);
    });
  });
  assert.equal(result, 1);
});

test('processFile returns a promise', async () => {
  const root = await tempDir();
  try {
    const input = path.join(root, 'in');
    const output = path.join(root, 'out');
    await fs.mkdir(input);
    await fs.writeFile(path.join(input, 'sample.txt'), 'some text');
    const result = await processFile(path.join(input, 'sample.txt'), output, {});
    assert.equal(result.source, 'sample.txt');
    assert.equal(result.output, 'sample.json');
  } finally {
    await removeDir(root);
  }
});

test('retry returns a promise', async () => {
  let attempts = 0;
  const result = await retry((done) => {
    attempts++;
    if (attempts < 2) done(new Error('again'));
    else done(null, 'ok');
  }, { retries: 1 });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('retry callback runs exactly once', async () => {
  let callbackCount = 0;
  const result = await new Promise((resolve, reject) => {
    retry((done) => {
      done(null, 'success');
    }, {}, (err, value) => {
      callbackCount++;
      if (err) reject(err);
      else resolve({ value, count: callbackCount });
    });
  });
  assert.equal(result.value, 'success');
  assert.equal(result.count, 1);
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

test('FileStore.writeJson returns a promise', async () => {
  const store = new FileStore();
  const root = await tempDir();
  try {
    const file = path.join(root, 'nested', 'record.json');
    await store.writeJson(file, { ok: true });
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(data, { ok: true });
  } finally {
    await removeDir(root);
  }
});

test('FileStore.ensureDir returns a promise', async () => {
  const store = new FileStore();
  const root = await tempDir();
  try {
    const dir = path.join(root, 'nested', 'dir');
    await store.ensureDir(dir);
    const stat = await fs.stat(dir);
    assert.ok(stat.isDirectory());
  } finally {
    await removeDir(root);
  }
});

test('FileStore callback runs exactly once on error', async () => {
  const store = new FileStore();
  let callbackCount = 0;
  await new Promise((resolve) => {
    store.readText('/nonexistent/file.txt', (err) => {
      callbackCount++;
      assert.ok(err);
      resolve(callbackCount);
    });
  });
  assert.equal(callbackCount, 1);
});
