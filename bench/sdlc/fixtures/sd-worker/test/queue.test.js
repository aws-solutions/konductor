'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueue } = require('../src');

test('take returns jobs in order and waits when empty', async () => {
  const q = createQueue();
  q.push({ id: 'a' });
  assert.equal((await q.take()).id, 'a');
  const later = q.take();
  q.push({ id: 'b' });
  assert.equal((await later).id, 'b');
});

test('close resolves waiting takes with null', async () => {
  const q = createQueue();
  const waiting = q.take();
  q.close();
  assert.equal(await waiting, null);
});
