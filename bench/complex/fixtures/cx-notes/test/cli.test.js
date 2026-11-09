'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src/cli');

const env = () => ({ NOTES_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-')), 'n.json') });

test('add then list prints the note', () => {
  const e = env();
  assert.deepEqual(run(['add', 'buy milk'], e), { code: 0, stdout: 'added 1\n', stderr: '' });
  assert.equal(run(['list'], e).stdout, '1\tbuy milk\n');
});

test('an empty list says so', () => {
  assert.equal(run(['list'], env()).stdout, 'no notes\n');
});

test('empty text is a usage error', () => {
  const r = run(['add', '  '], env());
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^error: /);
});

test('deleting an unknown id exits 3', () => {
  assert.equal(run(['delete', '9'], env()).code, 3);
});
