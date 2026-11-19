'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const test = require('node:test');
const { uploadFile, downloadFile, listFolder } = require('../src/handlers');
const { temporaryRoot, removeRoot } = require('./helpers');

test('uploads and downloads a document', async () => {
  const root = await temporaryRoot();
  try {
    const uploaded = await uploadFile(root, '111122223333', { name: 'notes.txt', content: 'meeting notes' });
    assert.equal(uploaded.status, 201);
    const downloaded = await downloadFile(root, '111122223333', { path: 'notes.txt' });
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.body.toString(), 'meeting notes');
  } finally {
    await removeRoot(root);
  }
});

test('lists the files in an account folder', async () => {
  const root = await temporaryRoot();
  try {
    await fs.mkdir(`${root}/111122223333`, { recursive: true });
    await fs.writeFile(`${root}/111122223333/readme.md`, 'hello');
    const result = await listFolder(root, '111122223333', { path: '' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.entries, [{ name: 'readme.md', kind: 'file' }]);
  } finally {
    await removeRoot(root);
  }
});
