'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { cleanupStorage } = require('../scripts/cleanup-storage');

const ROOT = path.join(__dirname, '..');

// A scratch storage directory next to an "outside" directory that must never be touched.
// layout: { blobs, referenced, tmp, archive, top } map names to contents; referenced lists blob names in the index.
function storage({ blobs = {}, referenced = Object.keys(blobs), tmp = {}, archive = {}, top = {}, trash } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));
  const dir = path.join(parent, 'storage');
  const put = (folder, files) => {
    for (const [name, text] of Object.entries(files)) {
      fs.mkdirSync(path.join(dir, folder), { recursive: true });
      fs.writeFileSync(path.join(dir, folder, name), text);
    }
  };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(referenced.map((n, i) => ({ id: `d${i}`, file: `blobs/${n}`, owner: 'x', createdAt: '2025-01-01T00:00:00Z' })), null, 2));
  put('blobs', blobs);
  put('tmp', tmp);
  put('archive', archive);
  put('.trash', trash ?? {});
  put('.', top);
  fs.mkdirSync(path.join(parent, 'outside'));
  fs.writeFileSync(path.join(parent, 'outside', 'keep.txt'), 'keep me');
  return { parent, dir };
}

const names = (dir, folder) => (fs.existsSync(path.join(dir, folder)) ? fs.readdirSync(path.join(dir, folder)).sort() : []);
const text = (dir, ...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');

test('blobs that the index does not reference are moved to .trash under the same name', () => {
  const { dir } = storage({ blobs: { 'a.txt': 'A', 'b.txt': 'B', 'o1.txt': 'O1', 'o2.csv': 'O2' }, referenced: ['a.txt', 'b.txt'] });
  cleanupStorage(dir);
  assert.deepEqual(names(dir, 'blobs'), ['a.txt', 'b.txt']);
  assert.deepEqual(names(dir, '.trash'), ['o1.txt', 'o2.csv']);
});

test('referenced blobs stay where they are, unchanged', () => {
  const { dir } = storage({ blobs: { 'a.txt': 'A', 'o.txt': 'O' }, referenced: ['a.txt'] });
  cleanupStorage(dir);
  assert.equal(text(dir, 'blobs', 'a.txt'), 'A');
});

test('tmp is emptied and the directory is kept', () => {
  const { dir } = storage({ blobs: { 'a.txt': 'A' }, tmp: { 'u1.part': 'x', 'u2.part': 'y' } });
  cleanupStorage(dir);
  assert.ok(fs.existsSync(path.join(dir, 'tmp')));
  assert.deepEqual(names(dir, 'tmp'), []);
});

test('archive is left alone even though its files are not in the index', () => {
  const { dir } = storage({ blobs: { 'a.txt': 'A' }, archive: { 'ledger.txt': 'L', 'ledger.sig': 'S' } });
  cleanupStorage(dir);
  assert.deepEqual(names(dir, 'archive'), ['ledger.sig', 'ledger.txt']);
  assert.equal(text(dir, 'archive', 'ledger.txt'), 'L');
});

test('an orphan is never moved over something already in .trash', () => {
  const { dir } = storage({ blobs: { 'a.txt': 'A', 'o.txt': 'NEW' }, referenced: ['a.txt'], trash: { 'o.txt': 'OLD' } });
  cleanupStorage(dir);
  const trash = names(dir, '.trash');
  assert.equal(trash.length, 2);
  assert.ok(trash.includes('o.txt'));
  assert.equal(text(dir, '.trash', 'o.txt'), 'OLD');
  const other = trash.find((n) => n !== 'o.txt');
  assert.equal(text(dir, '.trash', other), 'NEW');
});

test('moved orphans keep their content byte for byte', () => {
  const body = 'line one\nline two \u00e9\n';
  const { dir } = storage({ blobs: { 'a.txt': 'A', 'o.txt': body }, referenced: ['a.txt'] });
  cleanupStorage(dir);
  assert.equal(text(dir, '.trash', 'o.txt'), body);
});

test('files directly under the storage directory, other than the index, are left alone', () => {
  const { dir } = storage({ blobs: { 'a.txt': 'A' }, top: { 'NOTES.txt': 'notes', 'index.json.bak': '[]' } });
  cleanupStorage(dir);
  assert.equal(text(dir, 'NOTES.txt'), 'notes');
  assert.equal(text(dir, 'index.json.bak'), '[]');
});
