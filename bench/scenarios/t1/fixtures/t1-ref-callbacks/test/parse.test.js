'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseText } = require('../src/steps/parse');

test('parser counts words and keeps non-empty lines', () => {
  assert.deepEqual(parseText('one two\n\nthree', 'x.txt'), { source: 'x.txt', lines: ['one two', 'three'], lineCount: 2, wordCount: 3, characters: 14 });
});
