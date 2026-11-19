'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { downloadFile, listFolder } = require('../src/handlers');
const { clean, fs, path, setup, user } = require('./helpers');

async function outsideFixture(root) {
  const outside = path.join(root, 'outside.txt');
  await fs.writeFile(outside, 'private outside');
  return outside;
}

test('downloads an ordinary file from the caller folder', async () => {
  const root = await setup();
  try {
    await fs.writeFile(path.join(user(root), 'notes.txt'), 'hello');
    const result = await downloadFile(root, 'user-a', { path: 'notes.txt' });
    assert.equal(result.status, 200);
    assert.equal(result.body.toString(), 'hello');
  } finally { await clean(root); }
});

test('rejects parent traversal in a download path', async () => {
  const root = await setup();
  try {
    await outsideFixture(root);
    const result = await downloadFile(root, 'user-a', { path: '../outside.txt' });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});

test('rejects percent-encoded parent traversal', async () => {
  const root = await setup();
  try {
    await outsideFixture(root);
    const result = await downloadFile(root, 'user-a', { path: '%2e%2e%2foutside.txt' });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});

test('rejects backslash traversal after decoding', async () => {
  const root = await setup();
  try {
    await outsideFixture(root);
    const result = await downloadFile(root, 'user-a', { path: '%2e%2e%5coutside.txt' });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});

test('rejects an absolute download path', async () => {
  const root = await setup();
  try {
    const outside = await outsideFixture(root);
    const result = await downloadFile(root, 'user-a', { path: outside });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});

test('does not confuse a sibling account with the caller folder', async () => {
  const root = await setup();
  try {
    await fs.mkdir(path.join(root, 'user-aa'), { recursive: true });
    await fs.writeFile(path.join(root, 'user-aa', 'secret.txt'), 'other account');
    const result = await downloadFile(root, 'user-a', { path: '../user-aa/secret.txt' });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});

test('does not follow a file symlink outside the caller folder', async () => {
  const root = await setup();
  try {
    const outside = await outsideFixture(root);
    await fs.symlink(outside, path.join(user(root), 'shortcut'));
    const result = await downloadFile(root, 'user-a', { path: 'shortcut' });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});

test('does not reveal account paths in a failed folder listing', async () => {
  const root = await setup();
  try {
    await fs.mkdir(path.join(root, 'user-aa'), { recursive: true });
    const result = await listFolder(root, 'user-a', { path: '../user-aa' });
    assert.ok(result.status >= 400);
    assert.doesNotMatch(JSON.stringify(result.body), /user-aa/);
    assert.doesNotMatch(JSON.stringify(result.body), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally { await clean(root); }
});
