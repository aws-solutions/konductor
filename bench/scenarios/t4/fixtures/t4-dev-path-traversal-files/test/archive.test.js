'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { encodeArchive, readArchive } = require('../src/archive');

test('round trips the handoff archive format', () => {
  const archive = encodeArchive([
    { name: 'one.txt', content: 'one' },
    { name: 'folder/two.bin', content: Buffer.from([1, 2, 3]) }
  ]);
  const entries = readArchive(archive);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'one.txt');
  assert.equal(entries[0].content.toString(), 'one');
  assert.deepEqual(entries[1].content, Buffer.from([1, 2, 3]));
});

test('rejects an archive with a damaged header', () => {
  assert.throws(() => readArchive(Buffer.from('nope')), /invalid archive/);
});
