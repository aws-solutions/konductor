'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runPipeline } = require('../src');
const { tempDir, removeDir } = require('./helpers');

test('pipeline writes sorted text files', async () => {
  const root = await tempDir();
  try {
    const input = path.join(root, 'in'); const output = path.join(root, 'out');
    await fs.mkdir(input); await fs.writeFile(path.join(input, 'z.txt'), 'last file'); await fs.writeFile(path.join(input, 'a.txt'), 'first file');
    await new Promise((resolve, reject) => runPipeline(input, output, {}, (err, summary) => { if (err) reject(err); else { assert.equal(summary.processed, 2); assert.deepEqual(summary.files.map((x) => x.source), ['a.txt', 'z.txt']); resolve(); } }));
    const record = JSON.parse(await fs.readFile(path.join(output, 'a.json'), 'utf8'));
    assert.equal(record.wordCount, 2);
  } finally { await removeDir(root); }
});

test('pipeline reports a missing input', async () => {
  await new Promise((resolve) => runPipeline('/definitely/missing/sieve-input', '/tmp/sieve-out', {}, (err) => { assert.ok(err); resolve(); }));
});
