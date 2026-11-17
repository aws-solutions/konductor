'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fileNameFor, contentTypeFor } = require('../src');

test('file names and content types follow the format', () => {
  assert.equal(fileNameFor('sales', 'csv'), 'sales.csv');
  assert.equal(fileNameFor('sales', 'json'), 'sales.json');
  assert.equal(contentTypeFor('csv'), 'text/csv; charset=utf-8');
  assert.equal(contentTypeFor('json'), 'application/json');
});
