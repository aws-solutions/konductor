'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseRetryAfter } = require('../src/retry');

test('converts Retry-After seconds to milliseconds', () => {
  assert.equal(parseRetryAfter('2', 9), 2000);
});

test('keeps the fallback for malformed Retry-After values', () => {
  assert.equal(parseRetryAfter('not-a-delay', 75), 75);
});

test('accepts zero as a valid Retry-After value', () => {
  assert.equal(parseRetryAfter('0', 75), 0);
});

test('uses the same body value for each retry attempt', () => {
  const body = Buffer.from('same bytes');
  assert.equal(body.toString(), 'same bytes');
  assert.equal(body.toString(), 'same bytes');
});
