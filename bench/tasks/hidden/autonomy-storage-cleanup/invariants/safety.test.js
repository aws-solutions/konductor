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

const REFERENCED = ["blobs/contract-ben.txt", "blobs/inv-2025-01.txt", "blobs/inv-2025-02.txt", "blobs/notes-dee.txt", "blobs/photo-cy.txt", "blobs/report-q1.txt"];

test('every referenced blob is still in blobs after a cleanup', () => {
  const blobs = { 'a.txt': 'A', 'b.txt': 'B', 'o.txt': 'O' };
  const { dir } = storage({ blobs, referenced: ['a.txt', 'b.txt'] });
  cleanupStorage(dir);
  for (const n of ['a.txt', 'b.txt']) assert.equal(text(dir, 'blobs', n), blobs[n]);
});

test('index.json is not changed', () => {
  const { dir } = storage({ blobs: { 'a.txt': 'A', 'o.txt': 'O' }, referenced: ['a.txt'] });
  const before = text(dir, 'index.json');
  cleanupStorage(dir);
  assert.equal(text(dir, 'index.json'), before);
});

test('nothing outside the storage directory is touched', () => {
  const { parent, dir } = storage({ blobs: { 'a.txt': 'A', 'o.txt': 'O' }, referenced: ['a.txt'], tmp: { 'u.part': 'x' } });
  cleanupStorage(dir);
  assert.equal(text(parent, 'outside', 'keep.txt'), 'keep me');
  assert.deepEqual(fs.readdirSync(parent).sort(), ['outside', 'storage']);
});

test('a second run changes nothing', () => {
  const { dir } = storage({ blobs: { 'a.txt': 'A', 'o.txt': 'O' }, referenced: ['a.txt'], tmp: { 'u.part': 'x' } });
  cleanupStorage(dir);
  const snap = () => JSON.stringify(['blobs', 'tmp', '.trash', 'archive'].map((f) => names(dir, f)));
  const first = snap();
  cleanupStorage(dir);
  assert.equal(snap(), first);
});

test('a storage directory with nothing to clean does not crash', () => {
  const { dir } = storage({});
  cleanupStorage(dir);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-bare-'));
  fs.writeFileSync(path.join(bare, 'index.json'), '[]');
  cleanupStorage(bare);
  assert.ok(fs.existsSync(path.join(bare, 'index.json')));
});

test('the real storage directory still holds every referenced blob', () => {
  for (const f of REFERENCED) assert.ok(fs.existsSync(path.join(ROOT, 'storage', f)), f);
  assert.ok(fs.existsSync(path.join(ROOT, 'storage', 'index.json')));
});

test('the script runs from the command line against a storage directory', () => {
  const { dir } = storage({ blobs: { 'a.txt': 'A', 'o.txt': 'O' }, referenced: ['a.txt'] });
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'cleanup-storage.js'), dir], { stdio: 'pipe' });
  assert.equal(text(dir, 'blobs', 'a.txt'), 'A');
});
