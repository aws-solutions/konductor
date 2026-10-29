'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { titleCase } = require('../src/strings');

test('titleCase fixes mixed case', () => {
  assert.strictEqual(titleCase('hELLO wORLD'), 'Hello World');
});

test('titleCase returns empty string for empty input', () => {
  assert.strictEqual(titleCase(''), '');
});
