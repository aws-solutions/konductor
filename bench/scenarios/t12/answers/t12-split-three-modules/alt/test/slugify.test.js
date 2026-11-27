'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../src/slugify.js');

describe('src/slugify.js', () => {
  it('matches the spec table', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
    assert.equal(slugify('Crème brûlée & café'), 'creme-brulee-and-cafe');
    assert.equal(slugify('Straße'), 'strasse');
    assert.equal(slugify('  --  '), 'n-a');
    assert.equal(slugify('The quick brown fox', { maxLength: 12 }), 'the-quick');
    assert.equal(slugify('Supercalifragilistic', { maxLength: 5 }), 'super');
  });

  it('refuses bad input', () => {
    assert.throws(() => slugify(null), TypeError);
    assert.throws(() => slugify('a', { maxLength: 0 }), RangeError);
    assert.throws(() => slugify('a', { maxLength: 1.5 }), RangeError);
  });
});
