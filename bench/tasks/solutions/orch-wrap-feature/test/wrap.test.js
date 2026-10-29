'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { wrapText } = require('../src/wrap');

test('wraps at the width', () => {
  assert.deepStrictEqual(wrapText('the quick brown fox', 10), ['the quick', 'brown fox']);
});

test('keeps a long word on its own line', () => {
  assert.deepStrictEqual(wrapText('a extraordinarily b', 5), ['a', 'extraordinarily', 'b']);
});

test('returns no lines for empty text', () => {
  assert.deepStrictEqual(wrapText('', 10), []);
});

test('fills a line that is exactly the width', () => {
  assert.deepStrictEqual(wrapText('abc def', 7), ['abc def']);
});
