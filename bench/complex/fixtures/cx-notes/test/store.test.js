'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../src/store');
const { createNotes } = require('../src/service');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-')), 'n.json');

test('a missing file loads as an empty store', () => {
  const data = createStore(tmpFile()).load();
  assert.equal(data.nextId, 1);
  assert.deepEqual(data.notes, []);
});

test('saved notes load back', () => {
  const store = createStore(tmpFile());
  const notes = createNotes(store);
  notes.add('first');
  notes.add('second');
  assert.deepEqual(notes.list().map((n) => n.text), ['first', 'second']);
});

test('ids are not reused after a delete', () => {
  const notes = createNotes(createStore(tmpFile()));
  notes.add('a');
  notes.remove(1);
  assert.equal(notes.add('b').id, 2);
});
