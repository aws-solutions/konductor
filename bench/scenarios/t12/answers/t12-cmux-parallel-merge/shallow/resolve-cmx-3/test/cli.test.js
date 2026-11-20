'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli.js');
const { createStore } = require('../src/store.js');
const { formatDuration } = require('../src/format.js');

test('add and list', () => {
  const store = createStore();
  assert.equal(run(['add', '320', 'The', 'Dispossessed'], store), 'added b1');
  assert.equal(run(['add', '45', 'Essays'], store), 'added b2');
  assert.equal(run(['list'], store), '[ ] b1 The Dispossessed (5h 20m)\n[ ] b2 Essays (45m)');
});

test('done marks a book read', () => {
  const store = createStore([{ id: 'b1', title: 'Essays', minutes: 45 }]);
  assert.equal(run(['done', 'b1'], store), 'b1 read');
  assert.equal(run(['list'], store), '[x] b1 Essays (45m)');
});

test('help lists the commands', () => {
  assert.equal(run(['help'], createStore()), 'commands: add, done, list, stats, tag');
  assert.throws(() => run(['lend', 'b1'], createStore()), /unknown command: lend/);
});

test('reading time under and over an hour', () => {
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(90), '1h 30m');
});

test('bad input is refused', () => {
  assert.throws(() => run(['add', 'soon', 'Essays'], createStore()), /usage/);
  assert.throws(() => run(['done', 'b9'], createStore()), /no book b9/);
});
