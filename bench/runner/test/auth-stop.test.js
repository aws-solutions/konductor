// SPDX-License-Identifier: Apache-2.0
'use strict';

// A chunk stops after N consecutive login failures instead of launching the remaining runs, and `run` exits 6.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tmp, makeBench, write } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { runAll } = require('../lib/orchestrate.js');
const { loadTasks } = require('../lib/tasks.js');
const { readLedger } = require('../lib/credit-ledger.js');
const { maxAuthFailuresOf, DEFAULT_MAX_AUTH_FAILURES } = require('../lib/auth-failure.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const FAIL = { exitCode: 1, stderrText: 'Error: Authentication failed' };
const started = (probe) => fs.readdirSync(probe).filter((f) => /^started-\d+\.json$/.test(f)).length;

test('the limit defaults to 3, comes from the flag or BENCH_MAX_AUTH_FAILURES, and must be a positive integer', () => {
  assert.equal(DEFAULT_MAX_AUTH_FAILURES, 3);
  assert.equal(maxAuthFailuresOf(undefined, undefined), 3);
  assert.equal(maxAuthFailuresOf(undefined, '5'), 5);
  assert.equal(maxAuthFailuresOf('2', '5'), 2, 'the flag wins over the variable');
  for (const bad of ['0', '-1', '1.5', 'x', true]) assert.throws(() => maxAuthFailuresOf(bad, undefined), /positive integer/);
  assert.throws(() => maxAuthFailuresOf(undefined, 'abc'), /BENCH_MAX_AUTH_FAILURES/);
});

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

async function runWith(cfg, extra = {}, replicates = 6) {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const bin = path.join(root, 'bin');
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(bin, { dir: probe, ...cfg });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const scratchDir = path.join(root, 'scratch');
    fs.mkdirSync(scratchDir);
    const watch = path.join(root, 'watch');
    fs.mkdirSync(watch);
    const outDir = path.join(root, 'out');
    const ctx = {
      config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
      isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, outDir] },
    };
    const prev = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${prev}`;
    try {
      const out = await runAll({ tasks: [...loadTasks(bench).values()], arms: [ARM], prepared: new Map(), prepErrors: new Map(), replicates, parallel: 1, budgetCredits: null, censoredFloor: 1, seed: 1, outDir, ctx, state: { results: [], spent: 0, charged: 0 }, log: () => {}, ...extra });
      return { out, launched: started(probe), ledger: readLedger(outDir) };
    } finally { process.env.PATH = prev; }
  } finally { rm(root); }
}

test('three consecutive login failures stop the chunk; the rest are skipped and nothing more is launched', async () => {
  const { out, launched, ledger } = await runWith(FAIL);
  assert.equal(launched, 3);
  assert.equal(out.authStop.tripped, true);
  assert.equal(out.authStop.skipped, 3);
  assert.deepEqual(out.results.map((r) => r.status).sort(), ['budget_skipped', 'budget_skipped', 'budget_skipped', 'error', 'error', 'error']);
  assert.match(out.results.find((r) => r.status === 'budget_skipped').error, /login failure: 3 consecutive/);
  assert.equal(ledger.entries.length, 3);
  assert.equal(out.charged, 0);
});

test('the limit is configurable, and a run that works resets the count', async () => {
  const two = await runWith(FAIL, { maxAuthFailures: 2 });
  assert.equal(two.launched, 2);
  const turns = [FAIL, FAIL, { exitCode: 0 }, FAIL, FAIL, { exitCode: 0 }];
  const mixed = await runWith({ turns }, {}, 6);
  assert.equal(mixed.launched, 6);
  assert.equal(mixed.out.authStop.tripped, false);
});

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

test('run exits 6 after the limit, records authStop in summary.json, and honours --max-auth-failures and the environment variable', () => {
  const s = cliSetup(FAIL);
  try {
    const r = runCli(s, []);
    assert.equal(r.status, 6, r.stderr);
    assert.match(r.stderr, /LOGIN FAILURE/);
    assert.equal(started(s.probe), 3);
    const summary = JSON.parse(fs.readFileSync(path.join(s.out, 'summary.json'), 'utf8'));
    assert.equal(summary.authStop.tripped, true);
    assert.equal(summary.authStop.limit, 3);
    assert.equal(summary.maxAuthFailures, 3);
  } finally { rm(s.root); }
  const flag = cliSetup(FAIL);
  try {
    assert.equal(runCli(flag, ['--max-auth-failures', '2']).status, 6);
    assert.equal(started(flag.probe), 2);
  } finally { rm(flag.root); }
  const viaEnv = cliSetup(FAIL);
  try {
    assert.equal(runCli(viaEnv, [], { BENCH_MAX_AUTH_FAILURES: '4' }).status, 6);
    assert.equal(started(viaEnv.probe), 4);
  } finally { rm(viaEnv.root); }
});

test('a bad --max-auth-failures value is refused before anything starts', () => {
  const s = cliSetup(FAIL);
  try {
    const r = runCli(s, ['--max-auth-failures', '0']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--max-auth-failures must be a positive integer/);
    assert.equal(started(s.probe), 0);
  } finally { rm(s.root); }
});
