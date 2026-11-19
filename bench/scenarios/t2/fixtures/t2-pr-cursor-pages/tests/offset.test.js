'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOffset, pageByOffset } = require('../src/pagination/offset');

test('offset pagination returns a following offset', () => {
  const result = pageByOffset(['a', 'b', 'c'], parseOffset('1'), 1);
  assert.deepEqual(result, { items: ['b'], nextOffset: 2 });
});

test('bad offsets start at zero', () => {
  assert.equal(parseOffset('-2'), 0);
});
