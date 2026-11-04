// SPDX-License-Identifier: Apache-2.0
'use strict';

// The GPT cell and the Kiro v3 path: --model gpt-5.6-sol reaches the agent and is checked, the judge panel drops the
// subject's family, and a v3 arm installs with `konductor install --harness kiro-v3 --no-telemetry`. Fakes only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { tmp, makeBench, makeRun, write } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { kiro } = require('../lib/harness/index.js');
const sandbox = require('../lib/sandbox.js');
const { resolveJudges, DEFAULT_JUDGES } = require('../eval-commands.js');
const { modelFamily } = require('../../judge/config.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const FAKE_JUDGE = path.join(__dirname, 'fake-judge.js');
const GPT = 'gpt-5.6-sol';

// ---- the runner ----

test('the kiro-cli command carries --model gpt-5.6-sol and the v3 engine', () => {
  const arm = { id: 'main', agent: 'konductor', vanilla: false };
  const { args } = kiro.buildCommand({ arm, task: { prompt: 'p' }, config: { model: GPT, effort: 'high', agentEngine: 'v3' }, ctx: {} });
  assert.equal(args[args.indexOf('--model') + 1], GPT);
  assert.equal(args[args.indexOf('--agent-engine') + 1], 'v3');
});

function runSetup(sessionModel) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, sessionJson: true, model: sessionModel });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: { model: GPT, effort: 'high', agentEngine: 'v3' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
  };
  const prev = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prev}`;
  return { root, ctx, probe, task: loadTasks(bench).get('t1'), outDir: path.join(root, 'out', 't1'), cleanup: () => { process.env.PATH = prev; fs.rmSync(root, { recursive: true, force: true }); } };
}
const VANILLA = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

test('a run on gpt-5.6-sol that the session confirms is a success and records the model and engine', async () => {
  const s = runSetup(GPT);
  try {
    const r = await executeRun({ arm: VANILLA, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.status, 'success');
    assert.equal(r.model, GPT);
    assert.equal(r.sessionModel, GPT);
    assert.equal(r.agentEngine, 'v3');
    assert.equal(r.flags.includes('modelMismatch'), false);
    const started = JSON.parse(fs.readFileSync(path.join(s.probe, 'started.json'), 'utf8'));
    assert.equal(started.args[started.args.indexOf('--model') + 1], GPT);
  } finally { s.cleanup(); }
});

test('a session that ran on another model than gpt-5.6-sol is a modelMismatch error, not a quiet success', async () => {
  const s = runSetup('claude-sonnet-5.5');
  try {
    const r = await executeRun({ arm: VANILLA, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir });
    assert.equal(r.status, 'error');
    assert.ok(r.flags.includes('modelMismatch'));
    assert.match(r.error, /expected gpt-5\.6-sol/);
  } finally { s.cleanup(); }
});

test('the model is written into every installed agent of a GPT arm', () => {
  const root = tmp();
  try {
    write(path.join(root, '.kiro/agents/konductor.json'), JSON.stringify({ name: 'konductor', model: 'claude-sonnet-5.5' }));
    write(path.join(root, '.kiro/agents/k-developer.json'), JSON.stringify({ name: 'k-developer', model: GPT }));
    assert.deepEqual(sandbox.normalizeAgentModels(root, GPT), ['konductor']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.kiro/agents/konductor.json'), 'utf8')).model, GPT);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- the judge panel ----

test('the default panel drops the gpt family for a gpt subject and takes deepseek, glm and qwen3-coder-next', () => {
  const r = resolveJudges({ subjectModel: GPT });
  assert.deepEqual(r.judges, ['deepseek-3.2', 'glm-5', 'qwen3-coder-next']);
  assert.deepEqual(r.substituted, { dropped: ['gpt-5.6-luna'], added: ['qwen3-coder-next'] });
  assert.equal(r.small, false);
  const fams = r.judges.map(modelFamily);
  assert.equal(new Set(fams).size, 3);
  assert.ok(!fams.includes('claude') && !fams.includes('gpt'));
});

test('the same drop-and-substitute applies to a suite panel, and a Claude subject keeps the default panel untouched', () => {
  assert.deepEqual(resolveJudges({ suiteJudges: ['gpt-5.6-luna', 'deepseek-3.2', 'glm-5'], subjectModel: GPT }).judges, ['deepseek-3.2', 'glm-5', 'qwen3-coder-next']);
  const claude = resolveJudges({ subjectModel: 'claude-sonnet-5.5' });
  assert.deepEqual(claude.judges, DEFAULT_JUDGES);
  assert.equal(claude.substituted, undefined);
  assert.deepEqual(resolveJudges({}).judges, DEFAULT_JUDGES, 'no subject, no change');
});

test('a deepseek subject swaps in qwen3-coder-next; the substitutes never include a Claude model or the subject family', () => {
  const r = resolveJudges({ subjectModel: 'deepseek-3.2' });
  assert.deepEqual(r.judges, ['gpt-5.6-luna', 'glm-5', 'qwen3-coder-next']);
  for (const subject of [GPT, 'deepseek-3.2', 'glm-5', 'qwen3-coder-next', 'minimax-m2.5']) {
    const p = resolveJudges({ subjectModel: subject });
    assert.ok(p.judges.length >= 3, subject);
    assert.ok(p.judges.every((j) => modelFamily(j) !== 'claude' && modelFamily(j) !== modelFamily(subject)), subject);
    assert.equal(new Set(p.judges.map(modelFamily)).size, p.judges.length, `${subject}: one judge per family`);
  }
});

test('judges named on the command line are never rewritten: a same-family judge is still refused', () => {
  assert.throws(() => resolveJudges({ cliJudges: 'gpt-5.6-luna,deepseek-3.2,glm-5', subjectModel: GPT }), /same family as the subject model/);
  assert.deepEqual(resolveJudges({ cliJudges: 'deepseek-3.2,glm-5,minimax-m2.5', subjectModel: GPT }).judges, ['deepseek-3.2', 'glm-5', 'minimax-m2.5']);
});

test('judge on a gpt-5.6-sol run uses the substituted panel and records its families', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', model: GPT }, { arm: 'k', model: GPT }], { model: GPT });
    const r = spawnSync('node', [BENCH_JS, 'judge', '--run', runDir, '--bench-dir', bench, '--judge-cmd', FAKE_JUDGE, '--mode', 'rubric'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /subject gpt-5\.6-sol: judge panel dropped gpt-5\.6-luna, added qwen3-coder-next/);
    const j = JSON.parse(fs.readFileSync(path.join(runDir, 'judgments.json'), 'utf8'));
    assert.deepEqual(j.judges, ['deepseek-3.2', 'glm-5', 'qwen3-coder-next']);
    assert.deepEqual(j.panel, { families: ['deepseek', 'glm', 'qwen'], small: false });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- Kiro v3 through arm install ----

test('a v3 arm installs with konductor install --harness kiro-v3 --from <src> --no-telemetry, in a scratch HOME', () => {
  const root = tmp();
  try {
    const argvFile = path.join(root, 'argv');
    const homeFile = path.join(root, 'home');
    const bin = path.join(root, 'konductor');
    fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> '${argvFile}'\necho "$HOME" >> '${homeFile}'\nmkdir -p "$HOME/.kiro/agents"\nprintf '{"name":"konductor","model":"claude-sonnet-5.5"}' > "$HOME/.kiro/agents/konductor.json"\necho installed\n`, { mode: 0o755 });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const home = path.join(root, 'scratch-home');
    fs.mkdirSync(home);
    const outDir = path.join(root, 'out');
    fs.mkdirSync(outDir);
    const src = path.join(root, 'src');
    const meta = kiro.installInto(home, { arm: { id: 'main', vanilla: false, agent: 'konductor' }, prepared: { bin, exportDir: src }, ctx: { authDb }, config: { model: GPT, agentEngine: 'v3' }, outDir });
    assert.equal(fs.readFileSync(argvFile, 'utf8').trim(), `install --harness kiro-v3 --from ${src} --no-telemetry`);
    assert.equal(fs.realpathSync(fs.readFileSync(homeFile, 'utf8').trim()), fs.realpathSync(home), 'the install ran against the scratch HOME');
    assert.deepEqual(meta.rewrittenAgents, ['konductor']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.kiro/agents/konductor.json'), 'utf8')).model, GPT);
    assert.match(fs.readFileSync(path.join(outDir, 'install.log'), 'utf8'), /installed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a v3 trial install proves the entry agent exists, and fails when the arm does not install it', () => {
  const root = tmp();
  try {
    const bin = path.join(root, 'konductor');
    fs.writeFileSync(bin, '#!/bin/sh\nmkdir -p "$HOME/.kiro/agents"\nprintf \'{"name":"konductor","model":"m"}\' > "$HOME/.kiro/agents/konductor.json"\n', { mode: 0o755 });
    const src = path.join(root, 'src');
    fs.mkdirSync(src);
    const ctx = { config: { model: GPT, agentEngine: 'v3' } };
    const prepared = { bin, exportDir: src };
    assert.deepEqual(kiro.trialInstall(prepared, ctx), ['konductor']);
    assert.throws(() => kiro.trialInstall({ ...prepared, entryAgent: 'no-such-agent' }, ctx), /agent "no-such-agent" is not installed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
  const kiroBin = makeFakeKiro(path.join(root, 'bin'), { dir: probe, sessionJson: true, model: GPT });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(tmpdir);
  return { root, bench, repo, home, probe, kiroBin, authDb, tmpdir };
}

test('run --model gpt-5.6-sol --agent-engine v3 reaches the agent, records the cell and passes the isolation gate', () => {
  const s = cliSetup();
  try {
    const out = path.join(s.root, 'out');
    const r = spawnSync('node', [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--model', GPT, '--agent-engine', 'v3', '--bench-dir', s.bench, '--repo-root', s.repo,
      '--kiro-bin', s.kiroBin, '--auth-db', s.authDb, '--isolate', 'none', '--allow-unisolated', '--cache', path.join(s.root, 'cache'), '--out', out, '--replicates', '1', '--seed', '1'], {
      encoding: 'utf8', env: { ...process.env, HOME: s.home, TMPDIR: s.tmpdir, BENCH_GATE_HOMES: s.home, BENCH_TEST_MODE: '1' },
    });
    assert.equal(r.status, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(out, 'run-config.json'), 'utf8'));
    assert.equal(cfg.model, GPT);
    assert.equal(cfg.agentEngine, 'v3');
    assert.deepEqual(cfg.isolationGates.installs, [path.join(fs.realpathSync(s.home), '.konductor/installs')]);
    const res = JSON.parse(fs.readFileSync(path.join(out, 'vanilla/t1/1/result.json'), 'utf8'));
    assert.equal(res.status, 'success');
    assert.equal(res.model, GPT);
    assert.equal(res.installHarness, 'none', 'vanilla installs nothing');
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'isolation-gate.json'), 'utf8')).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')).isolationGate.ok, true);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('run exits 4 and says so when the real installs change during the batch', () => {
  const s = cliSetup();
  try {
    makeFakeKiro(path.join(s.root, 'bin'), { dir: s.probe, sessionJson: true, model: GPT, plantFile: path.join(s.home, '.konductor/installs/probe.json'), plantText: '{}' });
    const out = path.join(s.root, 'out');
    const r = spawnSync('node', [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--model', GPT, '--bench-dir', s.bench, '--repo-root', s.repo,
      '--kiro-bin', s.kiroBin, '--auth-db', s.authDb, '--isolate', 'none', '--allow-unisolated', '--cache', path.join(s.root, 'cache'), '--out', out, '--replicates', '1', '--seed', '1'], {
      encoding: 'utf8', env: { ...process.env, HOME: s.home, TMPDIR: s.tmpdir, BENCH_GATE_HOMES: s.home, BENCH_TEST_MODE: '1' },
    });
    assert.equal(r.status, 4, r.stderr);
    assert.match(r.stderr, /ISOLATION FAILURE: the real ~\/\.konductor\/installs changed/);
    const gate = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8')).isolationGate;
    assert.equal(gate.ok, false);
    const res = JSON.parse(fs.readFileSync(path.join(out, 'vanilla/t1/1/result.json'), 'utf8'));
    assert.equal(res.status, 'error', 'the run is kept, as an error');
    assert.ok(res.flags.includes('installsChanged'));
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
