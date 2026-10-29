'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { cnt, longestWord } = require('../src/words');

test('cnt counts words', () => {
  assert.strictEqual(cnt('one two  three'), 3);
});

test('cnt returns 0 for blank text', () => {
  assert.strictEqual(cnt('   '), 0);
});

test('longestWord returns the longest word', () => {
  assert.strictEqual(longestWord('a quick brown fox'), 'quick');
});
