'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPercent } = require('../src');

test('a ratio becomes a percentage with at most one decimal', () => {
  assert.equal(formatPercent(0.256), '25.6%');
  assert.equal(formatPercent(1), '100%');
  assert.equal(formatPercent(0), '0%');
});
