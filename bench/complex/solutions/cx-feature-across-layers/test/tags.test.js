'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../src/cli');

const env = () => ({ NOTES_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-')), 'n.json') });

test('add with tags lists them in order, lowercased and without repeats', () => {
  const e = env();
  assert.equal(run(['add', 'trip', '--tag', 'Travel', '--tag', 'ideas', '--tag', 'TRAVEL'], e).stdout, 'added 1\n');
  assert.equal(run(['list'], e).stdout, '1\ttrip\t#travel #ideas\n');
});

test('list --tag filters', () => {
  const e = env();
  run(['add', 'a', '--tag', 'x'], e);
  run(['add', 'b'], e);
  assert.equal(run(['list', '--tag', 'X'], e).stdout, '1\ta\t#x\n');
  assert.equal(run(['list', '--tag', 'nope'], e).stdout, 'no notes\n');
});

test('an invalid tag exits 2 and does not use an id', () => {
  const e = env();
  const r = run(['add', 'a', '--tag', 'ok', '--tag', 'bad tag'], e);
  assert.equal(r.code, 2);
  assert.equal(r.stderr, 'error: invalid tag "bad tag"\n');
  assert.equal(run(['add', 'b'], e).stdout, 'added 1\n');
});

test('a version 1 file still loads and is upgraded on write', () => {
  const e = env();
  fs.writeFileSync(e.NOTES_FILE, JSON.stringify({ version: 1, nextId: 2, notes: [{ id: 1, text: 'old', createdAt: 'x' }] }));
  assert.equal(run(['list'], e).stdout, '1\told\n');
  run(['tag', '1', 'legacy'], e);
  const saved = JSON.parse(fs.readFileSync(e.NOTES_FILE, 'utf8'));
  assert.equal(saved.version, 2);
  assert.deepEqual(saved.notes[0].tags, ['legacy']);
});
