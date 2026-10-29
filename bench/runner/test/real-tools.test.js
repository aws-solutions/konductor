// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lib = require('../../real/lib.js');
const { fetchEntry } = require('../../real/fetch.js');
const { materialize } = require('../../real/materialize.js');

const sh = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.org', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.org' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

// A local upstream with a base commit, a fix commit and a symlink plus an executable file.
function makeUpstream() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'real-up-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  fs.mkdirSync(path.join(dir, 'pkg'));
  fs.writeFileSync(path.join(dir, 'pkg/mod.py'), 'def add(a, b):\n    return a - b\n');
  fs.writeFileSync(path.join(dir, 'run.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
  fs.symlinkSync('pkg/mod.py', path.join(dir, 'link.py'));
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'base');
  const baseSha = sh(dir, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(dir, 'pkg/mod.py'), 'def add(a, b):\n    return a + b  # FIXED\n');
  sh(dir, 'commit', '-qam', 'fix');
  const mergeSha = sh(dir, 'rev-parse', 'HEAD');
  return {
    dir,
    entry: {
      id: 'demo', repo: { url: dir }, baseSha, mergeSha,
      baseTreeSha: sh(dir, 'rev-parse', `${baseSha}^{tree}`), mergeTreeSha: sh(dir, 'rev-parse', `${mergeSha}^{tree}`),
    },
  };
}

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('fetch pins both commits and a second call fetches nothing', () => {
  const up = makeUpstream();
  const cache = tmp('real-cache-');
  try {
    const logs = [];
    const first = fetchEntry(up.entry, { cache, allowLocal: true, log: (m) => logs.push(m) });
    assert.match(first.status, /base fetched, merge fetched/);
    assert.equal(logs.length, 2);
    const again = [];
    const second = fetchEntry(up.entry, { cache, allowLocal: true, log: (m) => again.push(m) });
    assert.match(second.status, /base cached, merge cached/);
    assert.deepEqual(again, []);
  } finally {
    fs.rmSync(up.dir, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('fetch rejects a tree id that differs from the pin, a branch name and non-github urls', () => {
  const up = makeUpstream();
  const cache = tmp('real-cache-');
  try {
    assert.throws(() => fetchEntry({ ...up.entry, baseTreeSha: '0'.repeat(40) }, { cache, allowLocal: true }), /pins/);
    assert.throws(() => fetchEntry({ ...up.entry, baseSha: 'main' }, { cache, allowLocal: true }), /not a full commit SHA/);
    assert.throws(() => fetchEntry({ ...up.entry, repo: { url: 'https://example.com/a/b' } }, { cache }), /only https:\/\/github.com/);
  } finally {
    fs.rmSync(up.dir, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('the cache cannot sit inside the repository', () => {
  assert.throws(() => lib.resolveCache(path.join(lib.REPO_ROOT, 'bench', 'cache')), /inside the repository/);
  assert.throws(() => lib.resolveCache(path.join(lib.REPO_ROOT, 'nope', 'deeper')), /inside the repository/);
  assert.doesNotThrow(() => lib.resolveCache(path.join(os.tmpdir(), 'real-ok')));
});

test('materialize writes the base tree only: no .git, no trace of the fix, modes kept', () => {
  const up = makeUpstream();
  const cache = tmp('real-cache-');
  const dest = path.join(tmp('real-dest-'), 'work');
  try {
    fetchEntry(up.entry, { cache, allowLocal: true });
    const r = materialize(up.entry, dest, { cache });
    assert.equal(fs.existsSync(path.join(dest, '.git')), false);
    assert.equal(fs.readFileSync(path.join(dest, 'pkg/mod.py'), 'utf8'), 'def add(a, b):\n    return a - b\n');
    assert.ok(fs.statSync(path.join(dest, 'run.sh')).mode & 0o111);
    assert.equal(fs.readlinkSync(path.join(dest, 'link.py')), 'pkg/mod.py');
    assert.deepEqual(r.files, ['link.py', 'pkg/mod.py', 'run.sh']);
    assert.equal(r.fileCount, 3);
    const all = spawnSync('grep', ['-r', '-l', 'FIXED', dest], { encoding: 'utf8' });
    assert.equal(all.stdout, '');
    const again = materialize(up.entry, path.join(tmp('real-dest-'), 'w2'), { cache });
    assert.equal(again.contentSha256, r.contentSha256);
    assert.equal(lib.hashTree(dest).sha256, r.contentSha256);
  } finally {
    fs.rmSync(up.dir, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
    fs.rmSync(path.dirname(dest), { recursive: true, force: true });
  }
});

test('materialize refuses a non-empty destination, a wrong content pin and an uncached task', () => {
  const up = makeUpstream();
  const cache = tmp('real-cache-');
  const dest = tmp('real-dest-');
  try {
    assert.throws(() => materialize(up.entry, dest, { cache }), /not in the cache/);
    fetchEntry(up.entry, { cache, allowLocal: true });
    fs.writeFileSync(path.join(dest, 'x'), 'x');
    assert.throws(() => materialize(up.entry, dest, { cache }), /not empty/);
    const clean = path.join(dest, 'sub');
    assert.throws(() => materialize({ ...up.entry, contentSha256: 'f'.repeat(64) }, clean, { cache }), /content hash/);
  } finally {
    fs.rmSync(up.dir, { recursive: true, force: true });
    fs.rmSync(cache, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('only fetch.js can reach the network', () => {
  const dirs = [path.join(lib.BENCH_DIR, 'real'), path.join(lib.BENCH_DIR, 'runner', 'lib')];
  const net = /['"`]fetch['"`]|['"`]clone['"`]|['"`]pull['"`]|ls-remote|\bcurl\b|\bwget\b|https?\.request|\bfetch\(/;
  const offenders = [];
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js') && n !== 'fetch.js')) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      if (net.test(text)) offenders.push(f);
    }
  }
  assert.deepEqual(offenders, []);
  const runnerLib = fs.readdirSync(path.join(lib.BENCH_DIR, 'runner', 'lib')).filter((n) => n.endsWith('.js'));
  for (const f of runnerLib) {
    assert.doesNotMatch(fs.readFileSync(path.join(lib.BENCH_DIR, 'runner', 'lib', f), 'utf8'), /real\/fetch(\.js)?['"]/);
  }
});
