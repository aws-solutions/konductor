// SPDX-License-Identifier: Apache-2.0
'use strict';

// Interpreter versions are recorded at run start (env.json and run-config.json), and a pin file lists the versions the task
// checks were validated with. A mismatch is flagged in run-config and logged; it never fails the run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tmp, makeBench, write } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const tc = require('../lib/toolchain.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

test('versionMatches compares dotted components, so 3.1 does not match 3.12', () => {
  assert.equal(tc.versionMatches('3.12', 'Python 3.12.13'), true);
  assert.equal(tc.versionMatches('3.12.13', 'Python 3.12.13'), true);
  assert.equal(tc.versionMatches('3.1', 'Python 3.12.13'), false);
  assert.equal(tc.versionMatches('24', 'v24.18.0'), true);
  assert.equal(tc.versionMatches('22', 'v24.18.0'), false);
  assert.equal(tc.versionMatches('8.4', 'pytest 8.4.2'), true);
  assert.equal(tc.versionMatches('3.12', null), false);
});

test('interpreterVersions asks each interpreter once and keeps a missing one as null', () => {
  const asked = [];
  const v = tc.interpreterVersions((cmd, args) => { asked.push([cmd, ...args].join(' ')); return cmd === 'python' ? null : `${cmd} stub`; });
  assert.deepEqual(Object.keys(v).sort(), ['node', 'pytest', 'python', 'python3']);
  assert.equal(v.python, null);
  assert.equal(v.node, process.version);
  assert.deepEqual(asked.filter((a) => a.startsWith('python3 -m pytest')), ['python3 -m pytest --version']);
});

test('checkPins flags a mismatch or a missing interpreter, applies task pins only to selected tasks, and ignores unpinned ones', () => {
  const pins = { global: { node: '24', python3: '3.12' }, tasks: { 'real-a': { pytest: '8.4' }, 'real-b': { pytest: '9' } } };
  const versions = { node: 'v24.1.0', python3: 'Python 3.9.1', python: null, pytest: 'pytest 8.4.2' };
  const r = tc.checkPins(pins, versions, ['real-a']);
  assert.equal(r.pinned, true);
  assert.deepEqual(r.mismatches.map((m) => [m.interpreter, m.expected, m.actual, m.scope]), [['python3', '3.12', 'Python 3.9.1', 'all tasks']]);
  const both = tc.checkPins(pins, versions, ['real-a', 'real-b']);
  assert.deepEqual(both.mismatches.map((m) => m.interpreter), ['python3', 'pytest']);
  assert.equal(both.mismatches[1].scope, 'real-b');
  const gone = tc.checkPins({ global: { python: '3' } }, versions, []);
  assert.deepEqual(gone.mismatches.map((m) => [m.interpreter, m.actual]), [['python', null]]);
  assert.deepEqual(tc.checkPins(null, versions, []), { pinned: false, mismatches: [] });
  assert.deepEqual(tc.checkPins({}, versions, []), { pinned: false, mismatches: [] });
});

test('loadPins reads tasks/toolchain/pins.json, tolerates its absence, and refuses a malformed file', () => {
  const root = tmp();
  try {
    assert.equal(tc.loadPins(root), null);
    write(path.join(root, 'tasks/toolchain/pins.json'), JSON.stringify({ global: { node: '24' } }));
    assert.deepEqual(tc.loadPins(root), { global: { node: '24' } });
    write(path.join(root, 'tasks/toolchain/pins.json'), '{ not json');
    assert.throws(() => tc.loadPins(root), /pins\.json/);
    write(path.join(root, 'tasks/toolchain/pins.json'), JSON.stringify({ global: { node: 24 } }));
    assert.throws(() => tc.loadPins(root), /must be a string/);
  } finally { rm(root); }
});

test('the bench pin file loads and names real tasks only', () => {
  const { loadTasks, BENCH_DIR } = require('../lib/tasks.js');
  const pins = tc.loadPins(BENCH_DIR);
  assert.ok(pins.global.node && pins.global.python3);
  const known = loadTasks(BENCH_DIR);
  for (const id of Object.keys(pins.tasks)) assert.ok(known.has(id), id);
});

function cliSetup(pins) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  fs.mkdirSync(path.join(bench, 'suites'), { recursive: true });
  fs.writeFileSync(path.join(bench, 'suites/lite.json'), JSON.stringify({ tasks: ['t1'], arms: ['vanilla'], replicates: 1, parallel: 1 }));
  if (pins) write(path.join(bench, 'tasks/toolchain/pins.json'), JSON.stringify(pins));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  write(path.join(repo, 'README'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.konductor/installs'), { recursive: true });
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const kiroBin = makeFakeKiro(path.join(root, 'bin'), { dir: probe, sessionJson: true });
  write(path.join(root, 'bin/python3'), '#!/bin/sh\necho "Python 3.9.1"\n');
  fs.chmodSync(path.join(root, 'bin/python3'), 0o755);
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(tmpdir);
  return { root, bench, repo, home, kiroBin, authDb, tmpdir, out: path.join(root, 'out') };
}

const runCli = (s) => spawnSync('node', [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--bench-dir', s.bench, '--repo-root', s.repo,
  '--kiro-bin', s.kiroBin, '--auth-db', s.authDb, '--isolate', 'none', '--allow-unisolated', '--cache', path.join(s.root, 'cache'), '--out', s.out, '--replicates', '1', '--seed', '1'], {
  encoding: 'utf8', env: { ...process.env, PATH: `${path.join(s.root, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: s.home, TMPDIR: s.tmpdir, BENCH_GATE_HOMES: s.home, BENCH_TEST_MODE: '1' },
});

test('run records interpreter versions in env.json and run-config.json and flags a pin mismatch without failing', () => {
  const s = cliSetup({ global: { python3: '3.12', node: process.version.replace(/^v/, '').split('.')[0] } });
  try {
    const r = runCli(s);
    assert.equal(r.status, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(s.out, 'run-config.json'), 'utf8'));
    assert.equal(cfg.interpreters.python3, 'Python 3.9.1');
    assert.equal(cfg.interpreters.node, process.version);
    assert.equal(cfg.toolchainCheck.pinned, true);
    assert.deepEqual(cfg.toolchainCheck.mismatches.map((m) => m.interpreter), ['python3']);
    const env = JSON.parse(fs.readFileSync(path.join(s.out, 'env.json'), 'utf8'));
    assert.equal(env.interpreters.python3, 'Python 3.9.1');
    assert.match(r.stderr, /warning: toolchain: python3 is Python 3\.9\.1, expected 3\.12/);
    const res = JSON.parse(fs.readFileSync(path.join(s.out, 'vanilla/t1/1/result.json'), 'utf8'));
    assert.equal(res.status, 'success');
  } finally { rm(s.root); }
});

test('run with matching pins, or no pin file, flags nothing', () => {
  const ok = cliSetup({ global: { python3: '3.9' } });
  const none = cliSetup(null);
  try {
    const a = runCli(ok);
    assert.equal(a.status, 0, a.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ok.out, 'run-config.json'), 'utf8')).toolchainCheck, { pinned: true, mismatches: [] });
    assert.doesNotMatch(a.stderr, /warning: toolchain/);
    const b = runCli(none);
    assert.equal(b.status, 0, b.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(none.out, 'run-config.json'), 'utf8'));
    assert.deepEqual(cfg.toolchainCheck, { pinned: false, mismatches: [] });
    assert.equal(cfg.interpreters.python3, 'Python 3.9.1');
  } finally { rm(ok.root); rm(none.root); }
});
