'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { countWords, longestWord } = require('../src/words');

test('countWords counts words', () => {
  assert.strictEqual(countWords('one two  three'), 3);
});

test('countWords returns 0 for blank text', () => {
  assert.strictEqual(countWords('   '), 0);
});

test('longestWord returns the longest word', () => {
  assert.strictEqual(longestWord('a quick brown fox'), 'quick');
});
