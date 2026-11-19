'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { uploadFile } = require('../src/handlers');
const { clean, fs, path, setup, user } = require('./helpers');

async function contents(root, name) {
  return fs.readFile(path.join(user(root), name), 'utf8');
}

test('accepts unicode and names with several dots', async () => {
  const root = await setup();
  try {
    const result = await uploadFile(root, 'user-a', { name: 'résumé..final.pdf', content: 'ok' });
    assert.equal(result.status, 201);
    assert.equal(await contents(root, 'résumé..final.pdf'), 'ok');
  } finally { await clean(root); }
});

test('rejects a slash in an uploaded filename', async () => {
  const root = await setup();
  try {
    const result = await uploadFile(root, 'user-a', { name: 'nested/report.txt', content: 'x' });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});

test('rejects a backslash in an uploaded filename', async () => {
  const root = await setup();
  try {
    const result = await uploadFile(root, 'user-a', { name: 'nested\\report.txt', content: 'x' });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});

test('rejects control characters in an uploaded filename', async () => {
  const root = await setup();
  try {
    const result = await uploadFile(root, 'user-a', { name: 'bad\nname.txt', content: 'x' });
    assert.ok(result.status >= 400);
  } finally { await clean(root); }
});

test('does not overwrite an existing file without the flag', async () => {
  const root = await setup();
  try {
    await fs.writeFile(path.join(user(root), 'notes.txt'), 'original');
    const result = await uploadFile(root, 'user-a', { name: 'notes.txt', content: 'replacement' });
    assert.equal(result.status, 409);
    assert.equal(await contents(root, 'notes.txt'), 'original');
  } finally { await clean(root); }
});

test('overwrites an existing file when explicitly requested', async () => {
  const root = await setup();
  try {
    await fs.writeFile(path.join(user(root), 'notes.txt'), 'original');
    const result = await uploadFile(root, 'user-a', { name: 'notes.txt', content: 'replacement', overwrite: true });
    assert.equal(result.status, 201);
    assert.equal(await contents(root, 'notes.txt'), 'replacement');
  } finally { await clean(root); }
});
