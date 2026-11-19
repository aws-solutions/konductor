'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { encodeArchive } = require('../src/archive');
const { importArchive } = require('../src/handlers');
const { clean, fs, path, setup, user } = require('./helpers');

test('imports a nested archive entry', async () => {
  const root = await setup();
  try {
    const archive = encodeArchive([{ name: 'reports/summary.txt', content: 'summary' }]);
    const result = await importArchive(root, 'user-a', { archive });
    assert.equal(result.status, 201);
    assert.equal(await fs.readFile(path.join(user(root), 'reports', 'summary.txt'), 'utf8'), 'summary');
  } finally { await clean(root); }
});

test('rejects parent traversal in an archive entry', async () => {
  const root = await setup();
  try {
    const target = path.join(root, 'escaped.txt');
    const archive = encodeArchive([{ name: '../escaped.txt', content: 'escape' }]);
    const result = await importArchive(root, 'user-a', { archive });
    assert.ok(result.status >= 400);
    await assert.rejects(fs.access(target));
  } finally { await clean(root); }
});

test('rejects an absolute archive entry', async () => {
  const root = await setup();
  try {
    const target = path.join(root, 'absolute.txt');
    const archive = encodeArchive([{ name: target, content: 'escape' }]);
    const result = await importArchive(root, 'user-a', { archive });
    assert.ok(result.status >= 400);
    await assert.rejects(fs.access(target));
  } finally { await clean(root); }
});

test('rejects backslash traversal in an archive entry', async () => {
  const root = await setup();
  try {
    const target = path.join(root, 'backslash.txt');
    const archive = encodeArchive([{ name: '..\\backslash.txt', content: 'escape' }]);
    const result = await importArchive(root, 'user-a', { archive });
    assert.ok(result.status >= 400);
    await assert.rejects(fs.access(target));
  } finally { await clean(root); }
});

test('does not write through a symlinked archive directory', async () => {
  const root = await setup();
  try {
    const outside = path.join(root, 'archive-outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(user(root), 'link'));
    const archive = encodeArchive([{ name: 'link/payload.txt', content: 'escape' }]);
    const result = await importArchive(root, 'user-a', { archive });
    assert.ok(result.status >= 400);
    await assert.rejects(fs.access(path.join(outside, 'payload.txt')));
  } finally { await clean(root); }
});

test('turns malformed percent encoding into a response', async () => {
  const root = await setup();
  try {
    const { downloadFile } = require('../src/handlers');
    const result = await downloadFile(root, 'user-a', { path: '%' });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});
