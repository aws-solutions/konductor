'use strict';

// Hidden test of t12-split-three-modules: docs/specs/word-stats.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const { wordStats } = require('../src/word-stats.js');

test('wordStats: the spec example', () => {
  assert.deepEqual(wordStats('The cat sat. The cat ran!', { top: 2 }), { words: 6, unique: 4, sentences: 2, longest: 'the', top: [['cat', 2], ['the', 2]] });
});

test('wordStats: apostrophes inside a word, not at its edges; letters of any script', () => {
  const s = wordStats("Don't stop 'til dawn' — naïve café");
  assert.equal(s.words, 6);
  assert.deepEqual(s.top.map(([w]) => w), ['café', 'dawn', "don't"]);
});

test('wordStats: sentences end at runs of . ! ? and trailing text counts once', () => {
  assert.equal(wordStats('Wait... what?! Really').sentences, 3);
  assert.equal(wordStats('...!?').sentences, 0);
  assert.equal(wordStats('').sentences, 0);
});

test('wordStats: longest is the first of the longest; null with no words; default top is 3', () => {
  const s = wordStats('aa bbb ccc dd bbb aa aa');
  assert.equal(s.longest, 'bbb');
  assert.deepEqual(s.top, [['aa', 3], ['bbb', 2], ['ccc', 1]]);
  assert.deepEqual(wordStats('  ').top, []);
  assert.equal(wordStats('  ').longest, null);
  assert.equal(wordStats('a b c', { top: 0 }).top.length, 0);
});

test('wordStats: a non-string throws TypeError', () => {
  assert.throws(() => wordStats(undefined), TypeError);
});
