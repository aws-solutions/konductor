'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { exportReport, contentTypeFor, fileNameFor, listFormats } = require('../src');

test('tsv escapes tab, newline, carriage return and backslash', () => {
  assert.equal(exportReport([{ v: 'a\tb\nc\rd\\e' }], { format: 'tsv' }), 'v\na\\tb\\nc\\rd\\\\e\n');
});

test('tsv writes null and missing values as empty fields', () => {
  assert.equal(exportReport([{ a: null }, {}], { format: 'tsv', columns: ['a'] }), 'a\n\n\n');
});

test('tsv has its content type and extension', () => {
  assert.equal(contentTypeFor('tsv'), 'text/tab-separated-values; charset=utf-8');
  assert.equal(fileNameFor('sales', 'tsv'), 'sales.tsv');
});

test('listFormats and the unknown format error agree', () => {
  assert.deepEqual(listFormats(), ['csv', 'json', 'tsv']);
  assert.throws(() => exportReport([], { format: 'xml' }), /available: csv, json, tsv/);
});
