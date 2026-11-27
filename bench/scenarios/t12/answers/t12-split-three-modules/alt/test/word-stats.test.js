'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { wordStats } = require('../src/word-stats.js');

describe('src/word-stats.js', () => {
  it('gives the spec example', () => {
    assert.deepEqual(wordStats('The cat sat. The cat ran!', { top: 2 }), { words: 6, unique: 4, sentences: 2, longest: 'the', top: [['cat', 2], ['the', 2]] });
  });

  it('keeps inner apostrophes and counts a trailing sentence', () => {
    const s = wordStats("Don't stop?! 'Nevermore' again");
    assert.equal(s.words, 4);
    assert.equal(s.sentences, 2);
    assert.equal(s.longest, 'nevermore');
    assert.equal(wordStats('Never fear. Ready').longest, 'never');
  });

  it('handles text with no words and refuses non-strings', () => {
    assert.deepEqual(wordStats('...'), { words: 0, unique: 0, sentences: 0, longest: null, top: [] });
    assert.throws(() => wordStats(3), TypeError);
  });
});
