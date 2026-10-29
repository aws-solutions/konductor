// SPDX-License-Identifier: Apache-2.0
'use strict';

// run --prepare-only builds and trial-installs every arm, prints the preflight table and stops before any agent run.
// The unit tests use a repo without the build layout so no cargo runs; the real build is shown in the smoke report.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');

const BENCH = path.join(__dirname, '..', 'bench.js');
const git = (repo, ...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  fs.mkdirSync(path.join(bench, 'suites'), { recursive: true });
  fs.writeFileSync(path.join(bench, 'suites/lite.json'), JSON.stringify({ tasks: ['t1'], arms: ['vanilla'], replicates: 1, parallel: 1 }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  write(path.join(repo, 'README'), 'no build layout here\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'one');
  git(repo, 'update-ref', 'refs/remotes/origin/main', git(repo, 'rev-parse', 'HEAD'));
  return { root, bench, repo, out: path.join(root, 'out'), cache: path.join(root, 'cache') };
}
// HOME points at an empty directory: --prepare-only must work without a kiro-cli login and write nothing there.
const run = (s, args) => spawnSync('node', [BENCH, 'run', '--suite', 'lite', '--bench-dir', s.bench, '--repo-root', s.repo, '--cache', s.cache, '--out', s.out, '--prepare-only', ...args], {
  encoding: 'utf8', env: { ...process.env, HOME: path.join(s.root, 'home') },
});

test('--prepare-only with vanilla only prints the table, exits 0, needs no login, and creates no output directory', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.root, 'home'));
  try {
    const r = run(s, ['--arms', 'vanilla']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /arm\s+ref\s+commit\s+mcp sha256\s+state/);
    assert.match(r.stdout, /vanilla\s+-\s+-\s+-\s+ready/);
    assert.equal(fs.existsSync(s.out), false, 'no run directory is created');
    assert.deepEqual(fs.readdirSync(path.join(s.root, 'home')), [], 'the HOME it was given stays empty');
    assert.doesNotMatch(r.stderr + r.stdout, /planned run|auth database|list-models/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('--prepare-only fails fast, with the reason, for a ref that predates the build layout, and starts no agent', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.root, 'home'));
  try {
    const r = run(s, ['--arms', 'vanilla,old=main']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /arm old could not be prepared.*no cli\/konductor-rs\/Cargo\.toml, mcp\/Cargo\.toml.*predates/s);
    assert.equal(fs.existsSync(s.out), false);
    assert.equal(fs.existsSync(s.cache) ? fs.readdirSync(s.cache).length : 0, 0, 'nothing was built or cached');
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('with --allow-partial the table marks the unbuildable arm FAILED and the exit code is still 1', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.root, 'home'));
  try {
    const r = run(s, ['--arms', 'vanilla,old=main', '--allow-partial']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /old@[0-9a-f]{7}\s+main\s+[0-9a-f]{10}\s+-\s+FAILED/);
    assert.match(r.stdout, /vanilla\s.*ready/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('an arm spec error is reported before anything is prepared', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.root, 'home'));
  try {
    const r = run(s, ['--arms', 'feat/x']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /name=ref/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('list-arms shows the syntax, and with --arms resolves each spec against the repo without building', () => {
  const s = setup();
  try {
    const r = spawnSync('node', [BENCH, 'list-arms', '--repo-root', s.repo, '--arms', 'vanilla,p=main'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /name=<git ref>/);
    assert.match(r.stdout, /name=dir:<path>/);
    assert.match(r.stdout, /vanilla\s+kiro-cli, empty ~\/\.kiro/);
    assert.match(r.stdout, /p@[0-9a-f]{7}\s+git\s+main/);
    const bad = spawnSync('node', [BENCH, 'list-arms', '--repo-root', s.repo, '--arms', 'p=nope'], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /ref "nope" not found.*never fetches/s);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
