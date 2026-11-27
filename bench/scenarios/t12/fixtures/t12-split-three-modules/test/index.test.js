'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const kit = require('../src/index.js');

test('index exports every helper', () => {
  for (const name of ['slugify', 'toRoman', 'fromRoman', 'wordStats']) assert.equal(typeof kit[name], 'function', name);
});
