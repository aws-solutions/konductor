'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { inside } = require('../src/paths');

test('a name inside the directory resolves', () => {
  assert.equal(inside('/data/store', 'blobs/a.txt'), path.join('/data/store', 'blobs', 'a.txt'));
});

test('a name that leaves the directory is refused', () => {
  assert.throws(() => inside('/data/store', '../other'), /escapes/);
});
