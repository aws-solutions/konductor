// SPDX-License-Identifier: Apache-2.0
'use strict';

// A throwaway bench dir, git repo, home and fake kiro-cli for tests that spawn `bench.js run`.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tmp, makeBench, write } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

function cliSetup(cfg) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  fs.mkdirSync(path.join(bench, 'suites'), { recursive: true });
  fs.writeFileSync(path.join(bench, 'suites/lite.json'), JSON.stringify({ tasks: ['t1'], arms: ['vanilla'], replicates: 1, parallel: 1 }));
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
  const kiroBin = makeFakeKiro(path.join(root, 'bin'), { dir: probe, ...cfg });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(tmpdir);
  return { root, bench, repo, home, kiroBin, authDb, tmpdir, probe, out: path.join(root, 'out') };
}

const runCli = (s, extra, env = {}) => spawnSync('node', [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--bench-dir', s.bench, '--repo-root', s.repo,
  '--kiro-bin', s.kiroBin, '--auth-db', s.authDb, '--isolate', 'none', '--allow-unisolated', '--cache', path.join(s.root, 'cache'), '--out', s.out, '--replicates', '5', '--seed', '1', ...extra], {
  encoding: 'utf8', env: { ...process.env, HOME: s.home, TMPDIR: s.tmpdir, BENCH_GATE_HOMES: s.home, BENCH_TEST_MODE: '1', ...env },
});

module.exports = { cliSetup, runCli };
