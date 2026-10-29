'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pad } = require('../src');

test('left and right pad to the width', () => {
  assert.equal(pad.left('7', 3), '  7');
  assert.equal(pad.right('7', 3), '7  ');
});
