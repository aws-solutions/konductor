'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pad, compactDate } = require('../src/format');

test('format helpers produce stable values', () => {
  assert.equal(pad(7, 3), '007');
  assert.equal(compactDate(new Date('2025-02-14T19:20:00Z')), '2025-02-14');
});
