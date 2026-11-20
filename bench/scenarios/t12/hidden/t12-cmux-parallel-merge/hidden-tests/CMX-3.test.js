'use strict';

// CMX-3: the stats command, through the CLI. Totals avoid whole hours so the test does not depend on CMX-1.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli.js');
const { createStore } = require('../src/store.js');

test('CMX-3 stats command', () => {
  assert.equal(run(['stats'], createStore()), 'books: 0, read: 0, left: 0m');
  const store = createStore([
    { id: 'b1', title: 'A', minutes: 320 },
    { id: 'b2', title: 'B', minutes: 45, read: true },
    { id: 'b3', title: 'C', minutes: 45 },
  ]);
  assert.equal(run(['stats'], store), 'books: 3, read: 1, left: 6h 5m');
  assert.equal(run(['stats', 'extra', 'args'], store), 'books: 3, read: 1, left: 6h 5m');
  run(['done', 'b1'], store);
  assert.equal(run(['stats'], store), 'books: 3, read: 2, left: 45m');
});
