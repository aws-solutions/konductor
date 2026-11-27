'use strict';

// Hidden test of t12-split-three-modules: docs/specs/slugify.md, one test per rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../src/slugify.js');

test('slugify: the spec examples', () => {
  assert.equal(slugify('Hello, World!'), 'hello-world');
  assert.equal(slugify('Crème brûlée & café'), 'creme-brulee-and-cafe');
  assert.equal(slugify('Straße'), 'strasse');
  assert.equal(slugify('  --  '), 'n-a');
  assert.equal(slugify('The quick brown fox', { maxLength: 12 }), 'the-quick');
  assert.equal(slugify('Supercalifragilistic', { maxLength: 5 }), 'super');
});

test('slugify: accents, ligatures and case', () => {
  assert.equal(slugify('ÉCOLE Ærå'), 'ecole-aera');
  assert.equal(slugify('naïve façade'), 'naive-facade');
});

test('slugify: & is a word, runs of other characters are one dash, no dash at the ends', () => {
  assert.equal(slugify('R&D'), 'r-and-d');
  assert.equal(slugify('--a__b..c--'), 'a-b-c');
  assert.equal(slugify('v2.0 / release'), 'v2-0-release');
});

test('slugify: maxLength cuts at a dash when it can, never ends on a dash, defaults to 60', () => {
  assert.equal(slugify('ab cdef', { maxLength: 2 }), 'ab');
  assert.equal(slugify('ab cdef', { maxLength: 3 }), 'ab');
  assert.equal(slugify('abc-def-ghi', { maxLength: 8 }), 'abc-def');
  const long = slugify('word '.repeat(30));
  assert.ok(long.length <= 60 && !long.endsWith('-'), long);
  assert.equal(long, Array(12).fill('word').join('-'));
});

test('slugify: bad input throws', () => {
  assert.throws(() => slugify(42), TypeError);
  assert.throws(() => slugify(null), TypeError);
  assert.throws(() => slugify('x', { maxLength: 0 }), RangeError);
  assert.throws(() => slugify('x', { maxLength: 2.5 }), RangeError);
});
