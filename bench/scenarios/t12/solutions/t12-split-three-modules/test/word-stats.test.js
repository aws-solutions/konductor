'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { wordStats } = require('../src/word-stats.js');

test('wordStats follows docs/specs/word-stats.md', () => {
  assert.deepEqual(wordStats('The cat sat. The cat ran!', { top: 2 }), { words: 6, unique: 4, sentences: 2, longest: 'the', top: [['cat', 2], ['the', 2]] });
  assert.equal(wordStats('Wait... what?! Really').sentences, 3);
});
