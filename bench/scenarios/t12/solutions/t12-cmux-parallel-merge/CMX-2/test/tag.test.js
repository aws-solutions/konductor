'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli.js');
const { createStore } = require('../src/store.js');

const shelf = () => createStore([{ id: 'b1', title: 'Essays', minutes: 45 }]);

test('CMX-2: tags are stored lower case without #', () => {
  const store = shelf();
  assert.equal(run(['tag', 'b1', '#SciFi'], store), 'b1 tagged #scifi');
  assert.equal(run(['tag', 'b1', 'scifi'], store), 'b1 already has #scifi');
  assert.equal(run(['list'], store), '[ ] b1 Essays (45m) #scifi');
});

test('CMX-2: at most 5 tags, and usage errors', () => {
  const store = shelf();
  for (const t of ['a', 'b', 'c', 'd', 'e']) run(['tag', 'b1', t], store);
  assert.throws(() => run(['tag', 'b1', 'f'], store), /b1 already has 5 tags/);
  assert.throws(() => run(['tag', 'b1'], store), /usage: tag <id> <tag>/);
});
