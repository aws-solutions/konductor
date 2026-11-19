'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { datePart, objectKey, jsonLines } = require('../src/format');

test('object keys include a normalized date directory', () => {
  assert.equal(objectKey('exports/', '2025-02-03', 'ledger.json'), 'exports/2025-02-03/ledger.json');
});

test('invalid dates are rejected', () => {
  assert.throws(() => datePart('03-02-2025'), /YYYY-MM-DD/);
});

test('jsonLines adds one line per record', () => {
  assert.equal(jsonLines([{ id: 1 }, { id: 2 }]), '{"id":1}\n{"id":2}\n');
});
