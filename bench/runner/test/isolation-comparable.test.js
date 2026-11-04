// SPDX-License-Identifier: Apache-2.0
'use strict';

// A run made without OS isolation is recorded as such and is never counted by a verdict. The runner refuses
// `--isolate none` unless `--allow-unisolated` is also given.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { tmp, makeBench, write } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { fixtureRun, mk, TASKS6 } = require('./verdict-fixtures.js');
const { buildResult } = require('../lib/result.js');
const V = require('../../report/verdict.js');
const op = require('../../report/orchpass.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const NEE = 'NOT ENOUGH EVIDENCE';
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const TASK = { id: 't1', class: 'simple', checks: [], rubric: [] };
const exec = { timedOut: false, exitCode: 0, wallClockMs: 10 };
const buildWith = (meta) => buildResult({
  arm: ARM, task: TASK, replicate: 1, config: { model: 'm', effort: 'high' }, exec, agg: { runFinishedStatus: 'success' }, session: null,
  checks: [], transcript: { chars: 1, bytes: 1, partial: false }, env: { kiroCliVersion: 'x' }, meta,
});

test('a result records its isolation mode and whether it is comparable; an unresolved mode is none and not comparable', () => {
  assert.deepEqual([buildWith({ isolation: 'unshare' }).isolation, buildWith({ isolation: 'unshare' }).comparable], ['unshare', true]);
  assert.deepEqual([buildWith({ isolation: 'sandbox-exec' }).isolation, buildWith({ isolation: 'sandbox-exec' }).comparable], ['sandbox-exec', true]);
  assert.deepEqual([buildWith({ isolation: 'none' }).isolation, buildWith({ isolation: 'none' }).comparable], ['none', false]);
  assert.deepEqual([buildWith({}).isolation, buildWith({}).comparable], ['none', false], 'no mode recorded at all');
  assert.deepEqual([buildWith({ isolation: 'auto' }).isolation, buildWith({ isolation: 'auto' }).comparable], ['none', false], 'auto is not a resolved mode');
});

function cliSetup() {
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
  const kiroBin = makeFakeKiro(path.join(root, 'bin'), { dir: probe, sessionJson: true });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(tmpdir);
  return { root, bench, repo, home, kiroBin, authDb, tmpdir, out: path.join(root, 'out') };
}

const runCli = (s, extra) => spawnSync('node', [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--bench-dir', s.bench, '--repo-root', s.repo,
  '--kiro-bin', s.kiroBin, '--auth-db', s.authDb, '--isolate', 'none', '--cache', path.join(s.root, 'cache'), '--out', s.out, '--replicates', '1', '--seed', '1', ...extra], {
  encoding: 'utf8', env: { ...process.env, HOME: s.home, TMPDIR: s.tmpdir, BENCH_GATE_HOMES: s.home, BENCH_TEST_MODE: '1' },
});

test('run --isolate none is refused on a scored suite without --allow-unisolated', () => {
  const s = cliSetup();
  try {
    const r = runCli(s, []);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--isolate none[^\n]*--allow-unisolated/);
    assert.equal(fs.existsSync(s.out), false, 'nothing was started');
  } finally { rm(s.root); }
});

test('run --isolate none --allow-unisolated records isolation none and comparable false in the result, run config and summary', () => {
  const s = cliSetup();
  try {
    const r = runCli(s, ['--allow-unisolated']);
    assert.equal(r.status, 0, r.stderr);
    const res = JSON.parse(fs.readFileSync(path.join(s.out, 'vanilla/t1/1/result.json'), 'utf8'));
    assert.equal(res.isolation, 'none');
    assert.equal(res.comparable, false);
    const cfg = JSON.parse(fs.readFileSync(path.join(s.out, 'run-config.json'), 'utf8'));
    assert.equal(cfg.isolation.mode, 'none');
    assert.equal(cfg.comparable, false);
    const sum = JSON.parse(fs.readFileSync(path.join(s.out, 'summary.json'), 'utf8'));
    assert.equal(sum.isolation.mode, 'none');
    assert.equal(sum.comparable, false);
  } finally { rm(s.root); }
});

// ---- reports ----

const ARMS = (extra = {}, baseExtra = {}) => ({
  vanilla: { hidden: [4], credits: 1, extra: baseExtra },
  a: { sha: 'a', hidden: [9], credits: 1.5, extra },
  'a-b': { sha: 'a', hidden: [9], credits: 1.5, extra },
});
const ISOLATED = { isolation: 'unshare', comparable: true };
const BARE = { isolation: 'none', comparable: false };
const verdictOf = (root, name, arms) => {
  const { dir, benchDir } = fixtureRun(root, name, { arms, tasks: TASKS6 });
  return V.buildVerdict({ dirs: [dir], benchDir }).arms.find((a) => a.label === 'a@aaaaaaa');
};

test('control: the same fixture with isolated runs is a KEEP', () => {
  const root = mk();
  try { const a = verdictOf(root, 'r1', ARMS(ISOLATED, ISOLATED)); assert.equal(a.verdict, 'KEEP', a.reason); } finally { rm(root); }
});

test('the platform verdict refuses unisolated runs of the arm or of the baseline', () => {
  const root = mk();
  try {
    const head = verdictOf(root, 'r1', ARMS(BARE, ISOLATED));
    assert.equal(head.verdict, NEE);
    assert.match(head.reason, /not isolated.*comparable/);
    const base = verdictOf(root, 'r2', ARMS(ISOLATED, BARE));
    assert.equal(base.verdict, NEE);
    assert.match(base.reason, /not isolated.*comparable/);
  } finally { rm(root); }
});

test('a result that says isolation none with no comparable field is also refused', () => {
  const root = mk();
  try {
    const a = verdictOf(root, 'r1', ARMS({ isolation: 'none' }, ISOLATED));
    assert.equal(a.verdict, NEE);
    assert.match(a.reason, /not isolated/);
  } finally { rm(root); }
});

test('comparable false on a result wins over an isolated mode, and a mode that is not recorded is not comparable', () => {
  const root = mk();
  try {
    const flagged = verdictOf(root, 'r1', ARMS({ isolation: 'unshare', comparable: false }, ISOLATED));
    assert.equal(flagged.verdict, NEE);
    assert.match(flagged.reason, /not isolated/);
    const unrecorded = verdictOf(root, 'r2', ARMS({ isolation: null, comparable: undefined }, ISOLATED));
    assert.equal(unrecorded.verdict, NEE);
  } finally { rm(root); }
});

const passCell = (root, name, arm, base) => {
  const meta = { model: 'claude-sonnet-5.5', agentEngine: 'v3', harness: 'kiro-cli' };
  const fx = fixtureRun(root, name, {
    arms: {
      vanilla: { hidden: [7, 8, 9, 8, 8], credits: 5, extra: { ...meta, ...base } },
      orch: { sha: 'a', hidden: [9], credits: 8, extra: { ...meta, ...arm } },
      'orch-b': { sha: 'a', hidden: [9], credits: 8, extra: { ...meta, ...arm } },
    },
    reps: 5, tasks: TASKS6, config: { model: meta.model, agentEngine: 'v3', harness: 'kiro-cli' },
  });
  return op.buildOrchestratorPass({ dirs: [fx.dir], benchDir: fx.benchDir, baseline: 'vanilla' }).cells[0].arms.find((a) => a.armId === 'orch');
};

test('the pass rule refuses unisolated runs and passes the isolated control', () => {
  const root = mk();
  try {
    const ok = passCell(root, 'c0', ISOLATED, ISOLATED);
    assert.equal(ok.call, op.PASS, ok.reasons.join('; '));
    for (const [name, arm, base] of [['c1', BARE, ISOLATED], ['c2', ISOLATED, BARE]]) {
      const a = passCell(root, name, arm, base);
      assert.equal(a.call, NEE, name);
      assert.match(a.reasons.join(' '), /not isolated.*comparable/);
    }
  } finally { rm(root); }
});
