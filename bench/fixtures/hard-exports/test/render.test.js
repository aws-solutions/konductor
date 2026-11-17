'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { exportReport } = require('../src');

const ROWS = [{ region: 'north', total: 120 }, { region: 'so,uth', total: null }];

test('csv has a header line and quotes a field with a comma', () => {
  assert.equal(exportReport(ROWS, { format: 'csv' }), 'region,total\nnorth,120\n"so,uth",\n');
});

test('json keeps the requested columns in order', () => {
  assert.equal(exportReport(ROWS, { format: 'json', columns: ['total'] }), '[\n  {\n    "total": 120\n  },\n  {\n    "total": null\n  }\n]\n');
});

test('an unknown format is refused', () => {
  assert.throws(() => exportReport(ROWS, { format: 'pdf' }), { code: 'UNKNOWN_FORMAT' });
});
