'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli.js');
const { createStore } = require('../src/store.js');

test('stats after marking a book done', () => {
  const store = createStore([{ id: 'b1', title: 'Long', minutes: 320 }, { id: 'b2', title: 'Short', minutes: 45 }]);
  run(['done', 'b2'], store);
  assert.equal(run(['stats', 'ignored'], store), 'books: 2, read: 1, left: 5h 20m');
});
