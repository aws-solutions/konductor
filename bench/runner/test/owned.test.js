// SPDX-License-Identifier: Apache-2.0
'use strict';

// The ownership marker: written atomically, readable back, free of secrets, and never added to a directory the bench did not create.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');
const owned = require('../lib/owned.js');

const OWNED_JS = path.join(__dirname, '..', 'lib', 'owned.js');

test('markOwned writes a complete marker with mode 0644 and leaves no temp file', () => {
  const root = mkScratch('owned-');
  const dir = path.join(root, 'out');
  fs.mkdirSync(dir);
  const m = owned.markOwned(dir, 'run-out', { id: 'study-1' });
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.kind, 'run-out');
  assert.equal(m.protect, false);
  assert.equal(m.id, 'study-1');
  assert.equal(m.pid, process.pid);
  assert.ok(Date.parse(m.createdAt) > 0 && Date.parse(m.lastUsedAt) > 0);
  assert.equal(typeof m.command, 'string');
  assert.ok(m.benchCommit === null || /^[0-9a-f]{40}$/.test(m.benchCommit));
  assert.equal(fs.statSync(path.join(dir, owned.MARKER_FILE)).mode & 0o777, 0o644);
  assert.deepEqual(fs.readdirSync(dir), [owned.MARKER_FILE]);
  assert.deepEqual(owned.readMarker(dir), m);
});

test('every kind is accepted and an unknown kind is refused', () => {
  const root = mkScratch('owned-');
  for (const kind of owned.KINDS) {
    const d = path.join(root, kind);
    fs.mkdirSync(d);
    assert.equal(owned.markOwned(d, kind).kind, kind);
  }
  assert.throws(() => owned.markOwned(root, 'results'), /unknown kind/);
});

test('refreshing keeps createdAt, id and protect and updates lastUsedAt', () => {
  const root = mkScratch('owned-');
  const first = owned.markOwned(root, 'cache', { id: 'c1', createdAt: '2020-01-01T00:00:00.000Z', protect: true });
  assert.equal(first.createdAt, '2020-01-01T00:00:00.000Z');
  const again = owned.markOwned(root, 'cache');
  assert.equal(again.createdAt, '2020-01-01T00:00:00.000Z');
  assert.equal(again.id, 'c1');
  assert.equal(again.protect, true);
  assert.ok(Date.parse(again.lastUsedAt) >= Date.parse(first.lastUsedAt));
});

test('a protected or differently typed marker is only touched, but archive always takes over', () => {
  const root = mkScratch('owned-');
  owned.markOwned(root, 'archive', { protect: true });
  const after = owned.markOwned(root, 'run-out');
  assert.equal(after.kind, 'archive');
  assert.equal(after.protect, true);
  const other = mkScratch('owned-');
  owned.markOwned(other, 'scratch');
  assert.equal(owned.markOwned(other, 'cache').kind, 'scratch');
  const upgraded = owned.markOwned(other, 'archive', { protect: true });
  assert.equal(upgraded.kind, 'archive');
  assert.equal(upgraded.protect, true);
});

test('the recorded command carries no credential values', () => {
  const argv = ['/usr/bin/node', path.join(__dirname, '..', 'bench.js'), 'run', '--aws-creds-file', '/x/secret.ini', '--api-key=abc123', '--session-token', 'tok', '--suite', 'lite'];
  const cmd = owned.sanitizedCommand(argv);
  assert.ok(!cmd.includes('secret.ini') && !cmd.includes('abc123') && !cmd.includes('tok '));
  assert.match(cmd, /--aws-creds-file \[redacted\]/);
  assert.match(cmd, /--api-key=\[redacted\]/);
  assert.match(cmd, /--suite lite/);
  assert.ok(cmd.startsWith('bench/runner/bench.js'));
  assert.ok(!/^\/|node /.test(cmd));
});

test('readMarker returns null for an absent, malformed, oversized or symlinked marker, and inspectMarker says why', () => {
  const root = mkScratch('owned-');
  const mk = (name) => { const d = path.join(root, name); fs.mkdirSync(d); return d; };
  const file = (d) => path.join(d, owned.MARKER_FILE);
  const absent = mk('absent');
  assert.equal(owned.readMarker(absent), null);
  assert.equal(owned.inspectMarker(absent).state, 'absent');
  const junk = mk('junk');
  fs.writeFileSync(file(junk), 'not json');
  assert.equal(owned.inspectMarker(junk).state, 'invalid');
  const wrong = mk('wrong');
  fs.writeFileSync(file(wrong), JSON.stringify({ schemaVersion: 1, kind: 'results', createdAt: '2020-01-01T00:00:00Z', protect: false, pid: null }));
  assert.match(owned.inspectMarker(wrong).error, /unknown kind/);
  const noProtect = mk('noprotect');
  fs.writeFileSync(file(noProtect), JSON.stringify({ schemaVersion: 1, kind: 'cache', createdAt: '2020-01-01T00:00:00Z', pid: null }));
  assert.match(owned.inspectMarker(noProtect).error, /protect/);
  const big = mk('big');
  fs.writeFileSync(file(big), ' '.repeat(70000));
  assert.match(owned.inspectMarker(big).error, /too large/);
  const real = mk('real');
  owned.markOwned(real, 'cache');
  const linked = mk('linked');
  fs.symlinkSync(file(real), file(linked));
  assert.match(owned.inspectMarker(linked).error, /not a regular file/);
});

test('markOwned refuses a symlink and a file', () => {
  const root = mkScratch('owned-');
  const d = path.join(root, 'd');
  fs.mkdirSync(d);
  fs.symlinkSync(d, path.join(root, 'l'));
  assert.throws(() => owned.markOwned(path.join(root, 'l'), 'cache'), /not a directory/);
  fs.writeFileSync(path.join(root, 'f'), 'x');
  assert.throws(() => owned.markOwned(path.join(root, 'f'), 'cache'), /not a directory/);
  assert.equal(owned.tryMark(path.join(root, 'l'), 'cache'), null);
});

test('ensureOwnedDir marks a directory it creates, refreshes a marked one, and leaves an existing unmarked one alone', () => {
  const root = mkScratch('owned-');
  const fresh = path.join(root, 'a', 'b', 'fresh');
  assert.equal(owned.ensureOwnedDir(fresh, 'cache'), true);
  assert.equal(owned.readMarker(fresh).kind, 'cache');
  assert.equal(owned.readMarker(path.join(root, 'a')), null);
  assert.equal(owned.ensureOwnedDir(fresh, 'cache'), false);
  assert.equal(owned.readMarker(fresh).kind, 'cache');
  const old = path.join(root, 'old');
  fs.mkdirSync(old);
  assert.equal(owned.ensureOwnedDir(old, 'cache'), false);
  assert.equal(owned.readMarker(old), null);
  assert.equal(fs.existsSync(path.join(old, owned.MARKER_FILE)), false);
});

test('the shell entry point marks a directory and records its parent as the owning pid', () => {
  const root = mkScratch('owned-');
  const d = path.join(root, 'scratch');
  fs.mkdirSync(d);
  const r = spawnSync(process.execPath, [OWNED_JS, 'mark', d, 'scratch', '--id', 'pilot-x'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const m = owned.readMarker(d);
  assert.equal(m.kind, 'scratch');
  assert.equal(m.id, 'pilot-x');
  assert.equal(m.pid, process.pid);
  assert.equal(spawnSync(process.execPath, [OWNED_JS, 'mark', d], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [OWNED_JS, 'mark', path.join(root, 'missing'), 'scratch'], { encoding: 'utf8' }).status, 1);
});

test('the run scratch root is marked as scratch', () => {
  const root = mkScratch('owned-');
  const prior = process.env.TMPDIR;
  process.env.TMPDIR = root;
  try {
    const dir = require('../lib/sandbox.js').makeScratchRoot();
    assert.equal(path.dirname(dir), root);
    assert.equal(owned.readMarker(dir).kind, 'scratch');
  } finally {
    if (prior === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = prior;
  }
});
