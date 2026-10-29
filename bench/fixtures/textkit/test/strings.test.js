'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { capitalize, truncate, initials } = require('../src/strings');

test('capitalize upper-cases the first letter', () => {
  assert.strictEqual(capitalize('hello there'), 'Hello there');
});

test('capitalize collapses extra spaces', () => {
  assert.strictEqual(capitalize('  hello   there '), 'Hello there');
});

test('truncate shortens long text with an ellipsis', () => {
  assert.strictEqual(truncate('abcdefghij', 8), 'abcde...');
});

test('truncate leaves short text alone', () => {
  assert.strictEqual(truncate('abc', 8), 'abc');
});

test('initials takes the first letter of each word', () => {
  assert.strictEqual(initials('ada  lovelace'), 'AL');
});
