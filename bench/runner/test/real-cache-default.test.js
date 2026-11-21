// SPDX-License-Identifier: Apache-2.0
'use strict';

// The real-repo cache defaults to the per-user state directory, and a judge or recheck finds the one a run recorded.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun } = require('./helpers.js');

const LIB = path.join(__dirname, '..', '..', 'real', 'lib.js');
const resolveIn = (env) => spawnSync(process.execPath, ['-e', `console.log(require(${JSON.stringify(LIB)}).resolveCache())`], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

test('the default cache follows XDG_STATE_HOME, else ~/.local/state, and BENCH_REAL_CACHE still wins', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    // The old shared /tmp cache is never read, even where it still exists (DEBT #21-legacy).
    assert.equal(resolveIn({ HOME: home }).stdout.trim(), path.join(fs.realpathSync(home), '.local', 'state', 'konductor-bench', 'realrepos'));
    const xdg = path.join(root, 'xdg');
    fs.mkdirSync(xdg);
    assert.equal(resolveIn({ HOME: home, XDG_STATE_HOME: xdg }).stdout.trim(), path.join(fs.realpathSync(xdg), 'konductor-bench', 'realrepos'));
    const own = path.join(root, 'own');
    fs.mkdirSync(own);
    assert.equal(resolveIn({ HOME: home, BENCH_REAL_CACHE: own }).stdout.trim(), fs.realpathSync(own));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('two users on one host get two default caches, each under their own home', () => {
  const root = tmp();
  try {
    const homes = ['alice', 'bob'].map((u) => { const h = path.join(root, u); fs.mkdirSync(h); return h; });
    const [a, b] = homes.map((home) => resolveIn({ HOME: home }).stdout.trim());
    assert.notEqual(a, b);
    homes.forEach((home, i) => assert.ok([a, b][i].startsWith(fs.realpathSync(home) + path.sep), [a, b][i]));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('loadRun points BENCH_REAL_CACHE at the cache the run recorded, unless it is already set', () => {
  const root = tmp();
  const prev = process.env.BENCH_REAL_CACHE;
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = path.join(root, 'run');
    makeRun(runDir, bench, [{ arm: 'vanilla' }]);
    fs.writeFileSync(path.join(runDir, 'run-config.json'), JSON.stringify({ real: { cache: path.join(os.tmpdir(), 'recorded-cache') } }));
    delete process.env.BENCH_REAL_CACHE;
    const { loadRun } = require('../../report/load.js');
    loadRun(runDir);
    assert.equal(process.env.BENCH_REAL_CACHE, path.join(os.tmpdir(), 'recorded-cache'));
    process.env.BENCH_REAL_CACHE = '/elsewhere';
    loadRun(runDir);
    assert.equal(process.env.BENCH_REAL_CACHE, '/elsewhere');
  } finally {
    if (prev === undefined) delete process.env.BENCH_REAL_CACHE; else process.env.BENCH_REAL_CACHE = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
