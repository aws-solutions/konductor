'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli.js');
const { createStore } = require('../src/store.js');

test('tag keeps one copy of each tag, lower case', () => {
  const store = createStore([{ id: 'b1', title: 'Dune', minutes: 600 }]);
  assert.equal(run(['tag', 'b1', 'Classic'], store), 'b1 tagged #classic');
  assert.equal(run(['tag', 'b1', '#CLASSIC'], store), 'b1 already has #classic');
});

test('a sixth tag is refused', () => {
  const store = createStore([{ id: 'b1', title: 'Dune', minutes: 600, tags: ['a', 'b', 'c', 'd', 'e'] }]);
  assert.throws(() => run(['tag', 'b1', 'f'], store), /already has 5 tags/);
});
