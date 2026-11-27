'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('every job module exports run', () => {
  for (const job of ['interest', 'statement', 'dormant', 'late-fee']) assert.equal(typeof require(`../src/jobs/${job}.js`).run, 'function', job);
});
