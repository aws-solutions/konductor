'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { slugify } = require('../src/slugify');

test('lowercases and joins words with a dash', () => {
  assert.strictEqual(slugify('Hello World'), 'hello-world');
});

test('drops punctuation', () => {
  assert.strictEqual(slugify('Hello, World!'), 'hello-world');
});
