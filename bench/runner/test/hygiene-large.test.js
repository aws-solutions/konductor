// SPDX-License-Identifier: Apache-2.0
'use strict';

// The credential scrub must cover files of any size, never follow symlinks, and say which files it could not scrub.
// Every secret is a made-up value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { scrubTree, scrubTreeDetailed, scanTree, MAX_BYTES, CHUNK_BYTES, overlapFor } = require('../lib/hygiene.js');

const KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const LITERAL = 'planted-literal-secret-value-7431';
const FILLER = 'lorem ipsum dolor sit amet\n';
const BIG = MAX_BYTES + 1024 * 1024;

function bigFile(file, plants, { mode = 0o640, size = BIG } = {}) {
  const buf = Buffer.alloc(size, FILLER);
  for (const [offset, text] of plants) buf.write(` ${text} `, offset);
  fs.writeFileSync(file, buf, { mode });
  fs.chmodSync(file, mode);
  return buf.length;
}

test('a file over the size cap is scrubbed in chunks: keys, literals and a secret on the hold-back cut are all replaced', () => {
  const dir = tmp();
  const file = path.join(dir, 'stream.jsonl');
  const cut = CHUNK_BYTES - overlapFor([LITERAL]);
  const size = bigFile(file, [[4 * 1024 * 1024, KEY], [5 * 1024 * 1024, LITERAL], [cut - 10, LITERAL], [cut + 100, KEY], [CHUNK_BYTES - 8, KEY], [2 * CHUNK_BYTES - 9, LITERAL], [BIG - 40, KEY]]);
  assert.ok(size > MAX_BYTES);
  assert.ok(scanTree(dir, { literals: [LITERAL] }).length >= 2, 'the scan sees the planted secrets in a large file');

  const r = scrubTreeDetailed(dir, [LITERAL], { shapes: true });
  assert.deepEqual({ scrubbed: r.scrubbed, files: r.files, unscrubbed: r.unscrubbed }, { scrubbed: 1, files: 1, unscrubbed: [] });
  const text = fs.readFileSync(file, 'latin1');
  assert.ok(!text.includes(KEY) && !text.includes(LITERAL));
  assert.equal((text.match(/<redacted>/g) || []).length, 7);
  assert.equal(text.length, size - 4 * (KEY.length - '<redacted>'.length) - 3 * (LITERAL.length - '<redacted>'.length));
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
  assert.deepEqual(scanTree(dir, { literals: [LITERAL] }), []);
  assert.deepEqual(fs.readdirSync(dir), ['stream.jsonl'], 'no temp file is left behind');
});

test('a large file with nothing to scrub is left untouched, with no temp file', () => {
  const dir = tmp();
  const file = path.join(dir, 'clean.log');
  bigFile(file, []);
  const before = fs.statSync(file);
  const r = scrubTreeDetailed(dir, [LITERAL], { shapes: true });
  assert.equal(r.scrubbed, 0);
  assert.equal(r.files, 1);
  const after = fs.statSync(file);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(fs.readdirSync(dir), ['clean.log']);
});

test('without shapes, a large file loses its literals but keeps key-shaped text', () => {
  const dir = tmp();
  const file = path.join(dir, 'a.log');
  bigFile(file, [[3 * 1024 * 1024, KEY], [6 * 1024 * 1024, LITERAL]]);
  assert.equal(scrubTree(dir, [LITERAL]), 1);
  const text = fs.readFileSync(file, 'latin1');
  assert.ok(text.includes(KEY));
  assert.ok(!text.includes(LITERAL));
});

test('scrubTree still returns the number of files rewritten, small files included', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'small.txt'), `id ${KEY} and ${LITERAL}\n`);
  fs.writeFileSync(path.join(dir, 'other.txt'), 'nothing here\n');
  assert.equal(scrubTree(dir, [LITERAL], { shapes: true }), 1);
  assert.equal(fs.readFileSync(path.join(dir, 'small.txt'), 'utf8'), 'id <redacted> and <redacted>\n');
});

test('a symlink in the tree is not followed, even when it points at a file that holds a secret', () => {
  const dir = tmp();
  const outside = tmp();
  const target = path.join(outside, 'creds.txt');
  fs.writeFileSync(target, `key ${KEY}\n`);
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.symlinkSync(target, path.join(dir, 'sub', 'link.txt'));
  fs.symlinkSync(outside, path.join(dir, 'dirlink'));
  fs.writeFileSync(path.join(dir, 'real.txt'), `key ${KEY}\n`);
  const r = scrubTreeDetailed(dir, [], { shapes: true });
  assert.equal(r.scrubbed, 1);
  assert.equal(r.files, 1);
  assert.deepEqual(r.skipped.map((s) => path.relative(dir, s.file)).sort(), [path.join('sub', 'link.txt'), 'dirlink'].sort());
  assert.ok(r.skipped.every((s) => /symlink/.test(s.reason)));
  assert.equal(fs.readFileSync(target, 'utf8'), `key ${KEY}\n`, 'the file behind the link is unchanged');
  assert.ok(fs.lstatSync(path.join(dir, 'sub', 'link.txt')).isSymbolicLink());
  assert.deepEqual(r.unscrubbed, []);
});

test('a file that cannot be scrubbed is listed with its reason, and the rest of the tree is still scrubbed', { skip: process.getuid?.() === 0 && 'root can read any file' }, () => {
  const dir = tmp();
  const locked = path.join(dir, 'a-locked.txt');
  fs.writeFileSync(locked, `key ${KEY}\n`);
  fs.chmodSync(locked, 0o000);
  fs.writeFileSync(path.join(dir, 'b-open.txt'), `key ${KEY}\n`);
  const r = scrubTreeDetailed(dir, [], { shapes: true });
  fs.chmodSync(locked, 0o600);
  assert.equal(r.scrubbed, 1);
  assert.equal(r.unscrubbed.length, 1);
  assert.equal(path.basename(r.unscrubbed[0].file), 'a-locked.txt');
  assert.match(r.unscrubbed[0].reason, /EACCES/);
  assert.equal(fs.readFileSync(path.join(dir, 'b-open.txt'), 'utf8'), 'key <redacted>\n');
});

test('a directory that cannot be listed is listed as unscrubbed', { skip: process.getuid?.() === 0 && 'root can read any directory' }, () => {
  const dir = tmp();
  const sub = path.join(dir, 'closed');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'x.txt'), `key ${KEY}\n`);
  fs.chmodSync(sub, 0o000);
  const r = scrubTreeDetailed(dir, [], { shapes: true });
  const hits = scanTree(dir);
  fs.chmodSync(sub, 0o700);
  assert.deepEqual(r.unscrubbed.map((u) => path.basename(u.file)), ['closed']);
  assert.deepEqual(hits, [{ file: sub, pattern: 'unreadable file' }]);
});

test('a secret-like run longer than the held-back window fails closed: the file is reported and left as it was', () => {
  const dir = tmp();
  const file = path.join(dir, 'blob.txt');
  const run = `sk-${'a'.repeat(MAX_BYTES + 512 * 1024)}`;
  fs.writeFileSync(file, `x ${run}\n`);
  const before = fs.readFileSync(file);
  const r = scrubTreeDetailed(dir, [], { shapes: true });
  assert.equal(r.scrubbed, 0);
  assert.equal(r.unscrubbed.length, 1);
  assert.match(r.unscrubbed[0].reason, /longer than/);
  assert.ok(fs.readFileSync(file).equals(before));
  assert.deepEqual(fs.readdirSync(dir), ['blob.txt']);
});
