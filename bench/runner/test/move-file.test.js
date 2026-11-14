// SPDX-License-Identifier: Apache-2.0
'use strict';

// moveFile never follows a link and refuses anything but a regular file the runner owns.
// The canary stands in for a host secret; every secret is a made-up value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmp } = require('./helpers.js');
const { moveFile, UntrustedFileError } = require('../lib/move-file.js');

const CANARY = 'canary-host-secret-0123456789';

function setup() {
  const dir = tmp();
  const live = path.join(dir, 'live');
  const out = path.join(dir, 'out');
  fs.mkdirSync(live);
  fs.mkdirSync(out);
  const canary = path.join(dir, 'canary.txt');
  fs.writeFileSync(canary, CANARY);
  return { dir, live, out, canary, src: path.join(live, 'stream.jsonl'), dest: path.join(out, 'stream.jsonl') };
}

const exdev = (fsImpl = fs) => ({ ...fsImpl, renameSync: () => { throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' }); } });
const fakeStat = (over) => ({ isFile: () => true, nlink: 1, uid: process.getuid(), mode: 0o100644, ...over });
const noCanary = (s) => !fs.existsSync(s.dest) || !fs.readFileSync(s.dest, 'utf8').includes(CANARY);

function refused(fn, reason) {
  assert.throws(fn, (e) => e instanceof UntrustedFileError && e.code === 'EUNTRUSTED' && (!reason || reason.test(e.reason)));
}

for (const [label, impl] of [['rename', () => fs], ['copy after EXDEV', () => exdev()]]) {
  test(`${label}: a regular file arrives intact and the source is gone`, () => {
    const s = setup();
    fs.writeFileSync(s.src, 'line one\nline two\n');
    fs.chmodSync(s.src, 0o640);
    moveFile(s.src, s.dest, impl());
    assert.equal(fs.readFileSync(s.dest, 'utf8'), 'line one\nline two\n');
    assert.equal(fs.existsSync(s.src), false);
    assert.equal(fs.statSync(s.dest).mode & 0o777, 0o640);
  });

  test(`${label}: a symlink to a host file is refused and its content is never copied`, () => {
    const s = setup();
    fs.symlinkSync(s.canary, s.src);
    refused(() => moveFile(s.src, s.dest, impl()), /not a regular file/);
    assert.ok(noCanary(s));
    assert.equal(fs.readFileSync(s.canary, 'utf8'), CANARY);
  });

  test(`${label}: a hardlink is refused`, () => {
    const s = setup();
    fs.linkSync(s.canary, s.src);
    refused(() => moveFile(s.src, s.dest, impl()), /hard link/);
    assert.ok(noCanary(s));
  });

  test(`${label}: a file owned by another user is refused`, () => {
    const s = setup();
    fs.writeFileSync(s.src, 'x');
    const real = fs.lstatSync(s.src);
    const stub = { ...impl(), lstatSync: () => fakeStat({ uid: real.uid + 1 }) };
    refused(() => moveFile(s.src, s.dest, stub), /another user/);
    assert.equal(fs.existsSync(s.dest), false);
    assert.equal(fs.existsSync(s.src), true);
  });

  test(`${label}: a FIFO is refused without being opened`, (t) => {
    const s = setup();
    try { execFileSync('mkfifo', [s.src]); } catch { t.skip('mkfifo is not available'); return; }
    refused(() => moveFile(s.src, s.dest, impl()), /not a regular file/);
    assert.equal(fs.existsSync(s.dest), false);
  });
}

test('copy path: a symlink swapped in after the lstat is not followed (O_NOFOLLOW)', () => {
  const s = setup();
  fs.symlinkSync(s.canary, s.src);
  const stub = { ...exdev(), lstatSync: () => fakeStat() };
  refused(() => moveFile(s.src, s.dest, stub), /symlink/);
  assert.equal(fs.existsSync(s.dest), false);
  assert.equal(fs.readFileSync(s.canary, 'utf8'), CANARY);
});

test('copy path: the descriptor is checked again, so a hardlink or foreign owner seen late is refused', () => {
  for (const [over, re] of [[{ nlink: 2 }, /hard link/], [{ uid: process.getuid() + 1 }, /another user/], [{ isFile: () => false }, /not a regular file/]]) {
    const s = setup();
    fs.writeFileSync(s.src, 'x');
    const stub = { ...exdev(), lstatSync: () => fakeStat(), fstatSync: () => fakeStat(over) };
    refused(() => moveFile(s.src, s.dest, stub), re);
    assert.equal(fs.existsSync(s.dest), false);
    assert.equal(fs.existsSync(s.src), true);
  }
});

test('copy path: an existing destination, even a symlink, is replaced and its target left alone', () => {
  const s = setup();
  const other = path.join(s.dir, 'other.txt');
  fs.writeFileSync(other, 'keep me');
  fs.symlinkSync(other, s.dest);
  fs.writeFileSync(s.src, 'fresh');
  moveFile(s.src, s.dest, exdev());
  assert.equal(fs.lstatSync(s.dest).isFile(), true);
  assert.equal(fs.readFileSync(s.dest, 'utf8'), 'fresh');
  assert.equal(fs.readFileSync(other, 'utf8'), 'keep me');
});

test('copy path: a file larger than one chunk is copied whole', () => {
  const s = setup();
  const big = Buffer.alloc(2.5 * 1024 * 1024, 'ab');
  fs.writeFileSync(s.src, big);
  moveFile(s.src, s.dest, exdev());
  assert.ok(fs.readFileSync(s.dest).equals(big));
});

test('an error other than EXDEV from rename is passed on', () => {
  const s = setup();
  fs.writeFileSync(s.src, 'x');
  const stub = { ...fs, renameSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  assert.throws(() => moveFile(s.src, s.dest, stub), { code: 'EACCES' });
});
