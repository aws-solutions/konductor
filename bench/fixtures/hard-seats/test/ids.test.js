'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIdSource } = require('../src/ids');

test('ids count up from 1 with the prefix', () => {
  const ids = createIdSource('b');
  assert.deepEqual([ids.next(), ids.next()], ['b-1', 'b-2']);
});
