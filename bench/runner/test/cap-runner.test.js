// SPDX-License-Identifier: Apache-2.0
'use strict';

// Runner changes made for capability benchmarking: contrast --by task, --extra-tasks, the budget headroom check and the
// per-run credit limit. A fake kiro-cli stands in for the agent; no credits are spent.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun, addTask } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { contrastRun, renderContrast } = require('../../report/contrast.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks, benchMask } = require('../lib/tasks.js');
const { makeLedger } = require('../lib/orchestrate.js');
const { skippedResult } = require('../lib/result.js');
const { executeRun } = require('../lib/run-one.js');
const { maskPaths } = require('../lib/run-cmd.js');
const { main } = require('../bench.js');

const VALIDATE = path.join(__dirname, '..', '..', 'tasks', 'validate-tasks.js');
const BENCH_JS = path.join(__dirname, '..', 'bench.js');

// ---- contrast --by task ----

const reps = (arm, n, task, f = () => ({})) => Array.from({ length: n }, (_, i) => ({ arm, task, rep: i + 1, ...f(i + 1) }));

function contrastSetup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  addTask(bench, 't2', 'review');
  const specs = [...reps('base', 3, 't1'), ...reps('base', 3, 't2'), ...reps('head', 3, 't1', () => ({ credits: 3 })), ...reps('head', 3, 't2', () => ({ credits: 1 }))];
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  return { root, bench, runDir, run: () => loadRun(runDir), tasks: () => loadTasks(bench), done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('contrast --by task has one scope per task, each holding only that task\'s runs', () => {
  const s = contrastSetup();
  try {
    const c = contrastRun({ run: s.run(), tasks: s.tasks(), base: 'base', by: 'task' });
    assert.deepEqual(c.scopes, ['overall', 't1', 't2']);
    assert.equal(c.cells.head.t1.metrics.cost.nHead, 3);
    assert.equal(c.cells.head.overall.metrics.cost.nHead, 6);
    assert.equal(c.cells.head.t1.metrics.cost.head, 3);
    assert.equal(c.cells.head.t2.metrics.cost.head, 1);
    assert.match(renderContrast(c), /### t1/);
  } finally { s.done(); }
});

test('contrast by class is the default and is unchanged', () => {
  const s = contrastSetup();
  try {
    const def = contrastRun({ run: s.run(), tasks: s.tasks(), base: 'base' });
    const cls = contrastRun({ run: s.run(), tasks: s.tasks(), base: 'base', by: 'class' });
    assert.deepEqual(def.scopes, ['overall', 'simple', 'review']);
    assert.deepEqual(cls, def);
    assert.throws(() => contrastRun({ run: s.run(), tasks: s.tasks(), base: 'base', by: 'weird' }), /--by takes class or task/);
  } finally { s.done(); }
});

test('the contrast command takes --by task and writes the per-task scopes', () => {
  const s = contrastSetup();
  const log = console.log;
  console.log = () => {};
  try {
    return main(['contrast', '--run', s.runDir, '--bench-dir', s.bench, '--base', 'base', '--by', 'task']).then(() => {
      console.log = log;
      const j = JSON.parse(fs.readFileSync(path.join(s.runDir, 'contrast.json'), 'utf8'));
      assert.deepEqual(j.scopes, ['overall', 't1', 't2']);
    }).finally(() => { console.log = log; s.done(); });
  } catch (e) { console.log = log; s.done(); throw e; }
});

// ---- --extra-tasks ----

const NO_QUESTIONS = 'Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work.';
const RUBRIC = [1, 2, 3].map((n) => ({ id: `r${n}`, criterion: `Criterion ${n}.`, weight: 1 }));

function extraDir(root, { id = 'x1', fixture = 'xf', task = {} } = {}) {
  const dir = path.join(root, 'extra');
  write(path.join(dir, 'fixtures', fixture, 'a.txt'), 'alpha\n');
  write(path.join(dir, 'fixtures', fixture, '.bench-answer-key.md'), 'key\n');
  write(path.join(dir, `${id}.json`), JSON.stringify({
    id, class: 'simple', target: null, prompt: `Create out.txt containing done. ${NO_QUESTIONS}`, fixture, timeoutSec: 120,
    checks: [{ type: 'file_exists', path: 'out.txt' }], rubric: RUBRIC, tiers: ['lite'], ...task,
  }));
  write(path.join(dir, 'solutions', id, 'out.txt'), 'done\n');
  return dir;
}

test('extra tasks load next to the bench tasks, with fixtures and hidden tests from their own directory', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const dir = extraDir(root, { task: { hidden: 'h1' } });
    write(path.join(dir, 'hidden', 'h1', 't.test.js'), 'x\n');
    const tasks = loadTasks(bench, { extraDirs: [dir] });
    assert.deepEqual([...tasks.keys()].sort(), ['t1', 'x1']);
    const x = tasks.get('x1');
    assert.equal(x.fixtureDir, path.join(dir, 'fixtures', 'xf'));
    assert.equal(x.hiddenDir, path.join(dir, 'hidden', 'h1'));
    assert.equal(x.extraDir, dir);
    assert.equal(tasks.get('t1').extraDir, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an extra task falls back to the bench fixtures and may not reuse an id or name a missing hidden dir', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const dir = path.join(root, 'extra');
    write(path.join(dir, 'x2.json'), JSON.stringify({ id: 'x2', class: 'simple', target: null, prompt: 'p', fixture: 'fx', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: RUBRIC, tiers: ['lite'] }));
    assert.equal(loadTasks(bench, { extraDirs: [dir] }).get('x2').fixtureDir, path.join(bench, 'fixtures', 'fx'));
    write(path.join(dir, 't1.json'), JSON.stringify({ id: 't1', class: 'simple', target: null, prompt: 'p', fixture: 'fx', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: RUBRIC, tiers: ['lite'] }));
    assert.throws(() => loadTasks(bench, { extraDirs: [dir] }), /duplicate task id t1/);
    fs.rmSync(path.join(dir, 't1.json'));
    write(path.join(dir, 'x3.json'), JSON.stringify({ id: 'x3', class: 'hard', target: null, prompt: 'p', fixture: 'fx', hidden: 'nope', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: RUBRIC, tiers: ['hard'] }));
    assert.throws(() => loadTasks(bench, { extraDirs: [dir] }), /hidden dir missing/);
    assert.throws(() => loadTasks(bench, { extraDirs: [path.join(root, 'nope')] }), /--extra-tasks directory not found/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the extra tasks directory is masked from the agent like tasks/hidden', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const dir = extraDir(root);
    assert.ok(benchMask(bench, [dir]).includes(dir));
    assert.deepEqual(benchMask(bench), benchMask(bench, []));
    const m = maskPaths({ benchDir: bench, extraDirs: [dir], outDir: '/out/x', awsCredsFile: null });
    assert.ok(m.includes(dir) && m.includes('/out/x') && m.includes(path.join(bench, 'tasks', 'hidden')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a task from an extra directory runs through executeRun with its own fixture', async () => {
  const s = execSetup({});
  try {
    const dir = extraDir(s.root);
    const task = loadTasks(path.join(s.root, 'bench'), { extraDirs: [dir] }).get('x1');
    const r = await executeRun({ arm: ARM, task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.checks[0].passed, true);
  } finally { s.cleanup(); }
});

test('the validator proves an extra task against its own solution and rejects one without', () => {
  const root = tmp();
  try {
    const dir = extraDir(root);
    const run = (d) => spawnSync(process.execPath, [VALIDATE, '--only-extra', '--extra-tasks', d], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(root, 'h') } });
    fs.mkdirSync(path.join(root, 'h'));
    const ok = run(dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /tasks: \d+ .*\(1 from 1 extra dir/);
    fs.rmSync(path.join(dir, 'solutions'), { recursive: true });
    const bad = run(dir);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /x1: missing reference solution at extra\/solutions\/x1\//);
    const unknown = spawnSync(process.execPath, [VALIDATE, '--extra-task', dir], { encoding: 'utf8' });
    assert.equal(unknown.status, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the run command refuses a missing --extra-tasks directory before anything starts', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const r = spawnSync(process.execPath, [BENCH_JS, 'run', '--suite', 'lite', '--bench-dir', bench, '--arms', 'vanilla', '--extra-tasks', path.join(root, 'none'), '--prepare-only'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(root, 'h') } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--extra-tasks directory not found/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- budget headroom ----

test('headroom: a launch is refused when charged plus the largest run so far would pass the budget', () => {
  const l = makeLedger({ budgetCredits: 10, runsPerReplicate: 1 });
  assert.equal(l.shouldSkip({ replicate: 1 }), false, 'nothing run yet, nothing to measure');
  l.add({ armId: 'a', credits: 4, creditsCensored: false });
  assert.equal(l.shouldSkip({ replicate: 1 }), false, '4 + 4 = 8 fits in 10');
  l.add({ armId: 'a', credits: 4, creditsCensored: false });
  assert.equal(l.shouldSkip({ replicate: 1 }), true, '8 + 4 = 12 passes 10');
  assert.match(l.skipReason(), /headroom.*charged 8\.000.*largest run so far 4\.000.*budget 10/);
});

test('headroom: charged plus the largest run exactly equal to the budget still launches', () => {
  const l = makeLedger({ budgetCredits: 12, runsPerReplicate: 1 });
  l.add({ armId: 'a', credits: 4, creditsCensored: false });
  l.add({ armId: 'a', credits: 4, creditsCensored: false });
  assert.equal(l.shouldSkip({ replicate: 1 }), false);
});

test('headroom uses the largest single run, with a censored run charged at its estimate', () => {
  const feed = (budget) => {
    const l = makeLedger({ budgetCredits: budget, runsPerReplicate: 1, floor: 3 });
    l.add({ armId: 'a', credits: 1, creditsCensored: false });
    l.add({ armId: 'b', credits: null, creditsCensored: true });
    return l;
  };
  assert.equal(feed(6).shouldSkip({ replicate: 1 }), true, 'charged 1 + 3 = 4, largest 3: 7 passes 6');
  assert.equal(feed(7).shouldSkip({ replicate: 1 }), false, '7 does not pass 7');
});

test('without a budget nothing is ever refused', () => {
  const l = makeLedger({ budgetCredits: null, runsPerReplicate: 1 });
  l.add({ armId: 'a', credits: 1000, creditsCensored: false });
  assert.equal(l.shouldSkip({ replicate: 1 }), false);
});

test('a budget_skipped result records why it was skipped', () => {
  const arm = { id: 'a', label: 'a', vanilla: true };
  const task = { id: 't1', class: 'simple', target: null };
  const r = skippedResult({ arm, task, replicate: 1, config: { model: 'm', effort: 'high' }, env: null, reason: 'budget headroom: charged 8.000 + largest run so far 4.000 would pass the budget 10' });
  assert.equal(r.status, 'budget_skipped');
  assert.match(r.error, /budget headroom: charged 8\.000/);
  assert.equal(skippedResult({ arm, task, replicate: 1, config: { model: 'm', effort: 'high' }, env: null }).error, 'budget reached');
});

// ---- per-run credit limit ----

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

function execSetup(cfg, ctxOver = {}) {
  const root = tmp();
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
  const ctx = {
    config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] }, ...ctxOver,
  };
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  return { root, ctx, outDir: path.join(root, 'out', 't1'), task: loadTasks(bench).get('t1'), cleanup: () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); } };
}

test('a run that passes the per-run credit limit is killed, flagged and recorded as censored', async () => {
  const s = execSetup({ credits: 3, hangAfterMetering: true }, { runCreditLimit: 1, creditPollMs: 50 });
  try {
    const t0 = Date.now();
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.ok(Date.now() - t0 < 20000, 'killed well before the fake agent would have finished');
    assert.equal(r.creditsCensored, true);
    assert.equal(r.status, 'error');
    assert.ok(r.flags.includes('creditLimit'), r.flags.join());
    assert.match(r.error, /per-run credit limit 1 reached/);
    assert.equal(r.credits, 3, 'the credits metered before the kill are kept');
  } finally { s.cleanup(); }
});

test('a run under the limit finishes normally and is not flagged', async () => {
  const s = execSetup({ credits: 0.5 }, { runCreditLimit: 5, creditPollMs: 50 });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success');
    assert.equal(r.creditsCensored, false);
    assert.equal(r.flags.includes('creditLimit'), false);
  } finally { s.cleanup(); }
});

test('without a limit nothing watches the stream', async () => {
  const s = execSetup({ credits: 50 });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success');
    assert.equal(r.credits, 50);
  } finally { s.cleanup(); }
});

test('--run-credit-limit must be a positive number and does not apply to opencode arms', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const run = (...a) => spawnSync(process.execPath, [BENCH_JS, 'run', '--suite', 'lite', '--bench-dir', bench, '--arms', 'vanilla', ...a], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(root, 'h') } });
    fs.mkdirSync(path.join(root, 'h'));
    assert.match(run('--run-credit-limit', '0').stderr, /--run-credit-limit must be a positive number/);
    assert.match(run('--run-credit-limit', 'abc').stderr, /--run-credit-limit must be a positive number/);
    assert.match(run('--arms', 'oc-vanilla', '--run-credit-limit', '2').stderr, /--run-credit-limit applies to kiro-cli arms only/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
