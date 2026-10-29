'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { slugify } = require('../src/slug');

test('lowercases and joins words with hyphens', () => {
  assert.strictEqual(slugify('Hello World'), 'hello-world');
});

test('drops punctuation', () => {
  assert.strictEqual(slugify('Hello, World!'), 'hello-world');
});

test('collapses repeated whitespace into one hyphen', () => {
  assert.strictEqual(slugify('Hello,   World'), 'hello-world');
});

test('does not keep hyphens at the ends', () => {
  assert.strictEqual(slugify('-- Hello --'), 'hello');
});
