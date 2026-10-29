'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatBytes } = require('../src');

const KB = 1024;
const MB = KB ** 2;
const GB = KB ** 3;
const TB = KB ** 4;

test('values under 1024 are whole bytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1), '1 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1023), '1023 B');
});

test('each 1024 steps up one unit', () => {
  assert.equal(formatBytes(KB), '1 KB');
  assert.equal(formatBytes(MB), '1 MB');
  assert.equal(formatBytes(GB), '1 GB');
  assert.equal(formatBytes(TB), '1 TB');
});

test('at most one decimal place, and a trailing .0 is dropped', () => {
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1331), '1.3 KB');
  assert.equal(formatBytes(1400), '1.4 KB');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(10752), '10.5 KB');
  assert.equal(formatBytes(1.5 * MB), '1.5 MB');
  assert.equal(formatBytes(3 * GB), '3 GB');
});

test('terabytes are the largest unit', () => {
  assert.equal(formatBytes(2048 * TB), '2048 TB');
  assert.equal(formatBytes(1536 * TB), '1536 TB');
});

test('a negative number is a RangeError', () => {
  assert.throws(() => formatBytes(-1), RangeError);
  assert.throws(() => formatBytes(-1024), RangeError);
});

test('NaN and Infinity are a RangeError', () => {
  assert.throws(() => formatBytes(NaN), RangeError);
  assert.throws(() => formatBytes(Infinity), RangeError);
  assert.throws(() => formatBytes(-Infinity), RangeError);
});

test('anything that is not a number is a TypeError', () => {
  for (const bad of ['12', null, undefined, {}, [], true]) assert.throws(() => formatBytes(bad), TypeError, String(bad));
});

test('it lives in src/bytes.js and is exported from src/index.js', () => {
  assert.equal(require('../src/bytes').formatBytes, formatBytes);
});
