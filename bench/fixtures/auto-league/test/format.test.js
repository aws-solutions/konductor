'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatTable } = require('../src');

test('columns are padded to the widest cell and trailing spaces are trimmed', () => {
  assert.equal(formatTable(['a', 'bb'], [['xxx', 1]]), 'a    bb\nxxx  1');
});
