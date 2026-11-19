'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeCursor, decodeCursor } = require('../src/pagination/cursor');

test('cursor tokens round-trip a page position', () => {
  const token = encodeCursor(17);
  assert.equal(decodeCursor(token), 17);
});

test('the first page uses an empty cursor', () => {
  assert.equal(decodeCursor(''), 0);
});

test('missing cursor starts at the beginning', () => {
  assert.equal(decodeCursor(undefined), 0);
});

test('negative positions are not accepted', () => {
  assert.equal(decodeCursor(encodeCursor(-1)), 0);
});

test('non-numeric tokens start at the beginning', () => {
  const token = Buffer.from('not-a-position').toString('base64');
  assert.equal(decodeCursor(token), 0);
});

test('cursor encoding remains a string for large positions', () => {
  const token = encodeCursor(999999);
  assert.equal(typeof token, 'string');
  assert.equal(decodeCursor(token), 999999);
});
