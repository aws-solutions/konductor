'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail } = require('../src');

test('normalizeEmail trims and lower-cases', () => {
  assert.equal(normalizeEmail('  Ana@Example.COM '), 'ana@example.com');
});

test('missing emails normalize to an empty string', () => {
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
});
