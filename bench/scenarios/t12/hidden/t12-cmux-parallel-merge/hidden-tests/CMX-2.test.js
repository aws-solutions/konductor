'use strict';

// CMX-2: the tag command, through the CLI.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../src/cli.js');
const { createStore } = require('../src/store.js');

test('CMX-2 tag command', () => {
  const store = createStore([{ id: 'b1', title: 'Essays', minutes: 45 }, { id: 'b2', title: 'Notes', minutes: 30 }]);
  assert.equal(run(['tag', 'b1', '#SciFi'], store), 'b1 tagged #scifi');
  assert.equal(run(['tag', 'b1', 'scifi'], store), 'b1 already has #scifi');
  assert.equal(run(['tag', 'b1', 'Classic'], store), 'b1 tagged #classic');
  assert.deepEqual(store.get('b1').tags, ['scifi', 'classic']);
  for (const t of ['a', 'b', 'c']) run(['tag', 'b1', t], store);
  assert.throws(() => run(['tag', 'b1', 'd'], store), /b1 already has 5 tags/);
  assert.equal(store.get('b1').tags.length, 5);
  assert.equal(run(['tag', 'b1', 'A'], store), 'b1 already has #a');
  assert.throws(() => run(['tag', 'b1'], store), /usage: tag <id> <tag>/);
  assert.throws(() => run(['tag'], store), /usage: tag <id> <tag>/);
  assert.throws(() => run(['tag', 'b9', 'x'], store), /no book b9/);
  assert.deepEqual(store.get('b2').tags, []);
  assert.match(run(['list'], store), /\[ \] b1 Essays \(45m\) #scifi #classic #a #b #c/);
});
