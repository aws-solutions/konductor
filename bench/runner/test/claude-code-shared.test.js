// SPDX-License-Identifier: Apache-2.0
'use strict';

// The shared code around the Claude Code harness: arms, runtimes, reports, flag guards, the CLI end to end against a
// fake claude, and a check that kiro-cli and opencode results still load and report as they did before.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { makeFakeClaude } = require('./fake-claude.js');
const { produce } = require('./regression-reports.js');
const { parseArmSpec, resolveArm, listArms, KNOWN_ARMS } = require('../lib/arms.js');
const { runtimeOf, isUsdRuntime } = require('../lib/harness/runtime.js');
const { loadRun } = require('../../report/load.js');
const { buildReport, defaultBaseline, BASIS } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');
const { cellKeyOf } = require('../../report/orchpass.js');
const { loadTasks } = require('../lib/tasks.js');
const { scanTree } = require('../lib/hygiene.js');
const { FLAGS } = require('../lib/cli-flags.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const BENCH_ROOT = path.join(__dirname, '..', '..');
const FX = path.join(__dirname, 'fixtures');
const MODEL = 'us.anthropic.claude-sonnet-5-5';
const SECRET = 'fakeSecretValueNotReal0123456789abcdefgh';
const TOKEN = 'fakeSessionTokenNotReal//ABCDEFGHIJKLMNOP==';
const KEY_ID = 'AK' + 'IATESTTESTTEST1234';
const CC_ENV = { AWS_ACCESS_KEY_ID: KEY_ID, AWS_SECRET_ACCESS_KEY: SECRET, AWS_SESSION_TOKEN: TOKEN };

const tokens = (total) => ({ input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: total - 2, total });
const ccOverrides = (usd, tok = 1000) => ({
  harness: 'claude-code', credits: null, kiroCliVersion: null, harnessVersion: '2.1.316.1544', model: MODEL,
  costUsd: usd, costCensored: false, tokens: tokens(tok), estTokens: { value: tok, isEstimate: false },
});

test('existing kiro-cli and opencode results still build and report exactly as before the Claude Code harness', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(FX, 'regression', 'reports.golden.json'), 'utf8'));
  assert.deepEqual(produce(BENCH_ROOT), golden);
});

test('arm specs: the cc- prefix selects the Claude Code runtime and keeps the same conditions', () => {
  assert.equal(parseArmSpec('cc-vanilla').cc, true);
  assert.equal(parseArmSpec('cc-pr-105=pr-105').cc, true);
  assert.equal(parseArmSpec('cc-pr-105=pr-105').name, 'pr-105');
  const v = resolveArm('cc-vanilla', '/nonexistent');
  assert.deepEqual([v.id, v.runtime, v.harness, v.agent, v.vanilla], ['cc-vanilla', 'claude-code', 'none', null, true]);
  assert.ok(KNOWN_ARMS.includes('cc-vanilla') && KNOWN_ARMS.includes('cc-main'));
  const row = listArms().find((a) => a.id === 'cc-main');
  assert.match(row.condition, /Claude Code/);
  assert.equal(resolveArm('oc-vanilla', '/nonexistent').runtime, 'opencode');
  assert.equal(resolveArm('vanilla', '/nonexistent').runtime, 'kiro-cli');
});

test('runtimeOf and isUsdRuntime name the three harnesses', () => {
  assert.equal(runtimeOf({ runtime: 'claude-code' }), 'claude-code');
  assert.equal(runtimeOf({ harness: 'claude-code' }), 'claude-code');
  assert.equal(runtimeOf({ harness: 'opencode' }), 'opencode');
  assert.equal(runtimeOf({ harness: 'claude' }), 'kiro-cli');
  assert.equal(runtimeOf({}), 'kiro-cli');
  assert.equal(runtimeOf(undefined), 'kiro-cli');
  assert.deepEqual(['kiro-cli', 'opencode', 'claude-code'].map(isUsdRuntime), [false, true, true]);
});

function makeCcRun(dir, bench, specs, config = {}) {
  makeRun(dir, bench, specs.map(({ arm, rep, usd, tok, ...rest }) => ({ arm, rep, ...rest, ...ccOverrides(usd, tok) })), { harness: 'claude-code', harnessVersion: '2.1.316.1544', model: MODEL, ...config });
  return dir;
}
const reps = (arm, f) => [1, 2, 3].map((rep) => ({ arm, rep, ...f(rep) }));

test('a Claude Code run reports in USD and tokens like opencode, with cc-vanilla as the baseline', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const dir = makeCcRun(path.join(root, 'run'), bench, [...reps('cc-vanilla', () => ({ usd: 0.04, tok: 20000 })), ...reps('cc-k', (r) => ({ usd: 0.1 * r, tok: 50000 * r }))]);
    const run = loadRun(dir);
    assert.equal(run.harness, 'claude-code');
    assert.equal(BASIS['claude-code'], BASIS.opencode);
    assert.equal(defaultBaseline(run), 'cc-vanilla');
    const r = buildReport({ run, tasks: loadTasks(bench) });
    assert.equal(r.report.costUnit, 'usd');
    assert.equal(r.report.baseline, 'cc-vanilla');
    assert.equal(r.report.arms['cc-k'].overall.efficiency.costUsd.median, 0.2);
    const md = renderMarkdown(r.report);
    assert.match(md, /claude-code 2\.1\.316\.1544/);
    assert.match(md, /USD per successful run/);
    assert.doesNotMatch(md, /credits per successful run/);
    const cell = cellKeyOf(run);
    assert.deepEqual([cell.harness, cell.model, cell.key], ['claude-code', MODEL, `claude-code / ${MODEL}`]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('one run directory holds one harness: a Claude Code result next to a kiro-cli one is refused', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const dir = makeCcRun(path.join(root, 'run'), bench, [{ arm: 'cc-vanilla', rep: 1, usd: 0.1 }]);
    makeRun(path.join(root, 'k'), bench, [{ arm: 'vanilla', rep: 1 }]);
    fs.cpSync(path.join(root, 'k', 'vanilla'), path.join(dir, 'vanilla'), { recursive: true });
    assert.throws(() => loadRun(dir), /mixes harnesses \(claude-code, kiro-cli\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the run flags for Claude Code are in the flag table', () => {
  for (const f of ['claude-bin', 'claude-tools-dir', 'run-budget-usd', 'aws-region']) assert.ok(FLAGS.run.includes(f), f);
});

function cliRoot(cfg = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  fs.mkdirSync(path.join(bench, 'suites'), { recursive: true });
  fs.writeFileSync(path.join(bench, 'suites/lite.json'), JSON.stringify({ tasks: ['t1'], arms: ['cc-vanilla'], replicates: 1, parallel: 1 }));
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  fs.mkdirSync(path.join(root, 'home'));
  fs.mkdirSync(path.join(root, 'tmp'));
  const bin = makeFakeClaude(path.join(root, 'tools'), { dir: probe, streamFile: path.join(FX, 'claude-code', 'vanilla-success.stream.jsonl'), tmpBases: [path.join(root, 'tmp')], ...cfg });
  return { root, bench, bin, probe };
}
const cli = (s, extra, env = CC_ENV) => spawn(process.execPath, [
  BENCH_JS, 'run', '--suite', 'lite', '--tasks', 't1', '--isolate', 'none', '--allow-unisolated', '--bench-dir', s.bench, '--cache', path.join(s.root, 'cache'),
  '--claude-bin', s.bin, '--repo-root', s.root, ...extra,
], { env: { PATH: process.env.PATH, HOME: path.join(s.root, 'home'), TMPDIR: path.join(s.root, 'tmp'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
const collect = (child) => new Promise((resolve) => {
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('close', (code) => resolve({ code, out, err }));
});

test('CLI: a Claude Code run writes names-only run-config and env, a USD summary, and leaves nothing behind', async () => {
  const s = cliRoot();
  const out = path.join(s.root, 'out-cli');
  try {
    const r = await collect(cli(s, ['--arms', 'cc-vanilla', '--out', out, '--seed', '1', '--budget-usd', '1', '--run-budget-usd', '0.5'], { ...CC_ENV, AWS_PROFILE: 'ignored-profile' }));
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /AWS_PROFILE is set here and is not passed to claude/);
    const cfg = JSON.parse(fs.readFileSync(path.join(out, 'run-config.json'), 'utf8'));
    assert.equal(cfg.harness, 'claude-code');
    assert.equal(cfg.harnessVersion, '9.9.9');
    assert.equal(cfg.model, MODEL);
    assert.equal(cfg.canonicalModel, 'claude-sonnet-5-5');
    assert.equal(cfg.budgetUsd, 1);
    assert.equal(cfg.claudeCode.maxBudgetUsdPerRun, 0.5);
    assert.equal(cfg.claudeCode.permissionMode, 'acceptEdits');
    assert.match(cfg.claudeCode.binarySha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(cfg.claudeCode.credentials.variableNames, ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']);
    assert.deepEqual(cfg.claudeCode.credentials.notPassedWhenSet, ['AWS_PROFILE']);
    assert.ok(cfg.claudeCode.envVarNames.includes('CLAUDE_CONFIG_DIR'));
    assert.equal(cfg.claudeCode.effort.applied, false);
    assert.equal(fs.existsSync(path.join(out, 'env.json')), true);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.ok(summary.totalCostUsd > 0);
    assert.equal('totalCredits' in summary, false);
    assert.equal(summary.counts.success, 1);
    // The files name the variables on purpose; the scanner flags any mention of a name, so only values are checked here.
    assert.deepEqual(scanTree(out, { literals: [SECRET, TOKEN, KEY_ID] }).filter((h) => h.pattern === 'exact secret value' || h.pattern === 'access key id'), [], 'run outputs hold no credential value');
    assert.deepEqual(fs.readdirSync(path.join(s.root, 'tmp')).filter((n) => n.startsWith('claude-')), [], 'no claude-<uid> directory is left in the temp dir');
    const rep = spawnSync(process.execPath, [BENCH_JS, 'report', '--run', out, '--bench-dir', s.bench, '--baseline', 'cc-vanilla'], { encoding: 'utf8' });
    assert.equal(rep.status, 0, rep.stderr);
    assert.match(fs.readFileSync(path.join(out, 'report.md'), 'utf8'), /USD/);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test('CLI guards: flags that do not apply to Claude Code arms are refused before anything starts', async () => {
  const s = cliRoot();
  try {
    for (const [args, re] of [
      [['--agent-engine', 'v3'], /--agent-engine applies to kiro-cli arms only; claude-code arms have no agent engine/],
      [['--effort', 'high'], /--effort does not apply to Claude Code arms/],
      [['--stop-on', 'end_turn'], /--stop-on does not apply to Claude Code arms/],
      [['--max-tool-calls', '3'], /--max-tool-calls does not apply to Claude Code arms/],
      [['--aws-creds-file', 'x'], /--aws-creds-file does not apply to Claude Code arms/],
      [['--run-credit-limit', '3'], /--run-credit-limit applies to kiro-cli arms only.*--run-budget-usd/],
      [['--budget-credits', '3'], /--budget-credits does not apply here: claude-code runs are costed in USD, use --budget-usd/],
      [['--run-budget-usd', '0'], /--run-budget-usd must be a positive number/],
    ]) {
      const r = await collect(cli(s, ['--arms', 'cc-vanilla', '--out', path.join(s.root, 'o'), ...args]));
      assert.notEqual(r.code, 0, args.join(' '));
      assert.match(r.err, re, args.join(' '));
      assert.equal(fs.existsSync(path.join(s.probe, 'started.json')), false, 'claude was never started');
    }
    const kiro = await collect(spawn(process.execPath, [BENCH_JS, 'run', '--suite', 'lite', '--tasks', 't1', '--bench-dir', s.bench, '--arms', 'vanilla', '--claude-bin', s.bin, '--repo-root', s.root, '--prepare-only'], { env: { PATH: process.env.PATH, HOME: path.join(s.root, 'home') }, stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.match(kiro.err, /--claude-bin applies to Claude Code \(cc-\) arms only/);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test('CLI: missing credentials stop the run before claude starts and the message names variables, not values', async () => {
  const s = cliRoot();
  try {
    const r = await collect(cli(s, ['--arms', 'cc-vanilla', '--out', path.join(s.root, 'o')], {}));
    assert.notEqual(r.code, 0);
    assert.match(r.err, /missing AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY/);
    assert.equal(fs.existsSync(path.join(s.probe, 'started.json')), false);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test('CLI: a launcher is refused as the claude binary', async () => {
  const s = cliRoot();
  try {
    const launcher = path.join(s.root, 'launcher', 'claude');
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const r = await collect(cli({ ...s, bin: launcher }, ['--arms', 'cc-vanilla', '--out', path.join(s.root, 'o')]));
    assert.notEqual(r.code, 0);
    assert.match(r.err, /this is a launcher, not the claude binary/);
    assert.equal(fs.existsSync(path.join(s.probe, 'started.json')), false);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});

test('CLI: --claude-tools-dir picks the newest binary there, and with no binary source the run stops', async () => {
  const s = cliRoot();
  try {
    const viaDir = (extra) => spawn(process.execPath, [
      BENCH_JS, 'run', '--suite', 'lite', '--tasks', 't1', '--isolate', 'none', '--allow-unisolated', '--bench-dir', s.bench, '--cache', path.join(s.root, 'cache'),
      '--repo-root', s.root, '--arms', 'cc-vanilla', '--out', path.join(s.root, 'o'), ...extra,
    ], { env: { PATH: process.env.PATH, HOME: path.join(s.root, 'home'), TMPDIR: path.join(s.root, 'tmp'), ...CC_ENV }, stdio: ['ignore', 'pipe', 'pipe'] });
    const none = await collect(viaDir([]));
    assert.notEqual(none.code, 0);
    assert.match(none.err, /pass --claude-bin PATH or --claude-tools-dir DIR/);
    assert.equal(fs.existsSync(path.join(s.probe, 'started.json')), false);
    const ok = await collect(viaDir(['--claude-tools-dir', path.join(s.root, 'tools')]));
    assert.equal(ok.code, 0, ok.err.slice(-600));
    assert.match(ok.err, /claude 9\.9\.9 \(/);
    const kiro = await collect(spawn(process.execPath, [BENCH_JS, 'run', '--suite', 'lite', '--tasks', 't1', '--bench-dir', s.bench, '--arms', 'vanilla', '--claude-tools-dir', path.join(s.root, 'tools'), '--repo-root', s.root, '--prepare-only'], { env: { PATH: process.env.PATH, HOME: path.join(s.root, 'home') }, stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.match(kiro.err, /--claude-tools-dir applies to Claude Code \(cc-\) arms only/);
  } finally {
    fs.rmSync(s.root, { recursive: true, force: true });
  }
});
