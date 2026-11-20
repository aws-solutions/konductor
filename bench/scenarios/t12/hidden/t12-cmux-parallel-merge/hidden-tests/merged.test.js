'use strict';

// The merged result: both new commands are registered side by side, and stats writes reading time the way the
// list does (so the CMX-1 rule applies to its total too).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli.js');
const { createStore } = require('../src/store.js');

test('merged: tag and stats both registered, stats uses the shared reading time', () => {
  const store = createStore([{ id: 'b1', title: 'A', minutes: 90 }, { id: 'b2', title: 'B', minutes: 30 }]);
  assert.equal(run(['help'], store), 'commands: add, done, list, stats, tag');
  assert.equal(run(['tag', 'b1', 'Long'], store), 'b1 tagged #long');
  assert.equal(run(['stats'], store), 'books: 2, read: 0, left: 2h');
  assert.equal(run(['list'], store), '[ ] b1 A (1h 30m) #long\n[ ] b2 B (30m)');
});
