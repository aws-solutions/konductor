'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readIndex, referencedFiles, listFiles } = require('../src');

const storage = path.join(__dirname, '..', 'storage');

test('the index lists six documents', () => {
  assert.equal(readIndex(storage).length, 6);
});

test('referencedFiles returns paths relative to the storage directory', () => {
  assert.ok(referencedFiles(storage).has('blobs/inv-2025-01.txt'));
  assert.equal(referencedFiles(storage).size, 6);
});

test('listFiles returns the files of one folder, sorted', () => {
  assert.equal(listFiles(storage, 'tmp').length, 3);
  assert.deepEqual(listFiles(storage, 'nope'), []);
});
