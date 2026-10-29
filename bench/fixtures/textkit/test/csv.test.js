'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseLine, parseCsv } = require('../src/csv');

test('parseLine splits on commas', () => {
  assert.deepStrictEqual(parseLine('a,b,c'), ['a', 'b', 'c']);
});

test('parseLine keeps commas inside quotes', () => {
  assert.deepStrictEqual(parseLine('"a,b",c'), ['a,b', 'c']);
});

test('parseCsv parses several rows', () => {
  assert.deepStrictEqual(parseCsv('a,b\nc,d\n'), [['a', 'b'], ['c', 'd']]);
});
