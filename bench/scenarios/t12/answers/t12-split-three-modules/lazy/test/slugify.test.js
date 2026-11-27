'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../src/slugify.js');

test('slugify follows docs/specs/slugify.md', () => {
  assert.equal(slugify('Crème brûlée & café'), 'creme-brulee-and-cafe');
  assert.equal(slugify('The quick brown fox', { maxLength: 12 }), 'the-quick');
  assert.equal(slugify('  --  '), 'n-a');
  assert.throws(() => slugify(1), TypeError);
});
