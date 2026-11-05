'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('./parse');

test('parse reads an ISO date', () => {
  assert.deepEqual(parse('2025-03-14'), { year: 2025, month: 3, day: 14 });
});

test('parse rejects other text', () => {
  assert.throws(() => parse('14/03/2025'));
});
