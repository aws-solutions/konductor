'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli.js');
const { createStore } = require('../src/store.js');

test('CMX-3: stats counts books, read books and the time left', () => {
  const store = createStore([{ id: 'b1', title: 'A', minutes: 320 }, { id: 'b2', title: 'B', minutes: 45, read: true }, { id: 'b3', title: 'C', minutes: 45 }]);
  assert.equal(run(['stats'], store), 'books: 3, read: 1, left: 6h 5m');
});

test('CMX-3: an empty shelf', () => {
  assert.equal(run(['stats'], createStore()), 'books: 0, read: 0, left: 0m');
});
