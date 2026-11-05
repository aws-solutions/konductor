'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { format } = require('./format');

test('format pads the parts', () => {
  assert.equal(format({ year: 2025, month: 3, day: 4 }), '2025-03-04');
});
