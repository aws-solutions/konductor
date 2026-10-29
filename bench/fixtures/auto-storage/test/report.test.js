'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { folderSizes } = require('../src');

test('folderSizes reports each folder of the storage directory', () => {
  const sizes = folderSizes(path.join(__dirname, '..', 'storage'));
  assert.deepEqual(Object.keys(sizes).sort(), ['archive', 'blobs', 'tmp']);
  assert.ok(sizes.blobs > sizes.archive);
});
