// SPDX-License-Identifier: Apache-2.0
'use strict';

// The 2x2 pilot combiner (report/factorial.js, bench.js report-2x2) on synthetic judged run directories: the table,
// the effects, the descriptive-only rule, and every refusal. No model call, nothing outside the scratch directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, makeRun, addTask } = require('./helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const { taskRevision } = require('../../judge/revision.js');
const { buildFactorial, renderFactorial, canonicalModel } = require('../../report/factorial.js');
const { toMarkdown } = require('../../report/doc.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const TASKS = ['t1', 't2', 't3', 't4', 't5'];
const PANEL = ['deepseek-3.2', 'glm-5', 'gpt-5.6-luna'];
const MODELS = { 'gpt-5.6-luna': { bedrockModelId: 'global.openai.gpt-5.6-luna' }, 'deepseek-3.2': { bedrockModelId: 'deepseek.v3.2' }, 'glm-5': { bedrockModelId: 'zai.glm-5' } };
const SHA = 'bf07556f0000000000000000000000000000abcd';

function benchWith(root, ids = TASKS) {
  const bench = makeBench(path.join(root, 'bench'));
  for (const id of ids.filter((t) => t !== 't1')) addTask(bench, id, 'simple');
  return bench;
}

/**
 * One cell on disk. rubric(task, rep) gives the rubric score; quality is then 40 + 60 * rubric (checks pass).
 * Options: kind 'kiro' | 'cc', arm, tasks, reps, cost(task, rep), status(task, rep), spawns, panel, models, revision override, model, sha.
 */
function cell(root, bench, name, o) {
  const { kind, arm, tasks = TASKS, reps = 1, rubric = () => 0.5, cost = () => 1, status = () => 'success', spawns = 0, panel = PANEL, models = MODELS, revisionOf, model, sha = null, judged = true, extra = () => ({}) } = o;
  const cc = kind === 'cc';
  const specs = [];
  for (const task of tasks) {
    for (let rep = 1; rep <= reps; rep++) {
      const st = status(task, rep);
      const base = cc
        ? { harness: 'claude-code', credits: null, kiroCliVersion: null, harnessVersion: '2.1.316', model: model ?? 'us.anthropic.claude-sonnet-5-5', costUsd: cost(task, rep), costCensored: false, sessionModel: 'claude-sonnet-5-5', claudeCode: { canonicalModel: 'claude-sonnet-5-5', modelsSeen: ['claude-sonnet-5-5'], spawned: spawns } }
        : { credits: cost(task, rep), model: model ?? 'claude-sonnet-5.5', sessionModel: model ?? 'claude-sonnet-5.5', subagentCalls: spawns, agentEngine: 'v3' };
      specs.push({ arm, task, rep, status: st, commitSha: sha, orch: { spawns }, ...base, ...extra(task, rep), ...(st === 'timeout' ? { checks: [{ type: 'file_exists', path: 'a.txt', passed: false }] } : {}) });
    }
  }
  const dir = path.join(root, name);
  makeRun(dir, bench, specs, { taskIds: tasks, ...(cc ? { harness: 'claude-code', model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: model ? model.replace(/^us\.anthropic\./, '') : 'claude-sonnet-5-5' } : { model: model ?? 'claude-sonnet-5.5', agentEngine: 'v3' }) });
  if (judged) {
    const loaded = loadTasks(bench);
    const recs = [];
    for (const task of tasks) {
      for (let rep = 1; rep <= reps; rep++) {
        for (const judge of panel) {
          recs.push({ kind: 'rubric', judge, armId: arm, taskId: task, replicate: rep, taskRevision: revisionOf ? revisionOf(task) : taskRevision(loaded.get(task)), score: rubric(task, rep), scoreRaw: rubric(task, rep), criteria: [], judgeError: null, parseFailures: 0, calls: [], redactionsFired: {} });
        }
      }
    }
    write(path.join(dir, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: arm, backend: 'opencode', backendInfo: { backend: 'opencode', models }, judges: panel, modes: ['rubric'], panel: { families: ['deepseek', 'glm', 'gpt'], small: false }, rubric: recs, pairwise: [], graded: [], notJudged: [], spentUsd: 0.1, spentCredits: 0 }));
  }
  return dir;
}

// rubric 0.5 -> quality 70; per-task offsets make the contrasts distinct
const OFFSET = { t1: 0, t2: 0.1, t3: -0.1, t4: 0.05, t5: 0 };
function four(root, bench, over = {}) {
  const r = (shift) => (task) => Math.min(1, Math.max(0, 0.5 + OFFSET[task] + shift));
  const mk = (name, kind, arm, shift, extra = {}) => cell(root, bench, name, { kind, arm, rubric: r(shift), ...over.all, ...extra, ...(over[name] ?? {}) });
  return {
    kiroVanilla: [mk('kv', 'kiro', 'vanilla', 0, { cost: () => 1 })],
    kiroKonductor: [mk('kk', 'kiro', 'konductor', 0.1, { cost: () => 3, spawns: 2, sha: SHA })],
    ccVanilla: [mk('cv', 'cc', 'cc-vanilla', 0.05, { cost: () => 0.02 })],
    ccKonductor: [mk('ck', 'cc', 'cc-konductor', 0.2, { cost: () => 0.1, spawns: 3, sha: SHA })],
  };
}
const build = (bench, dirs) => buildFactorial({ dirs, benchDir: bench });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);

test('four cells at n=1 per task give the table, the effects and the cost ratios, and no interval', () => {
  const root = tmp();
  const bench = benchWith(root);
  const res = build(bench, four(root, bench));
  const byId = Object.fromEntries(res.cells.map((c) => [c.id, c]));
  near(byId.kiroVanilla.quality, 40 + 60 * 0.51);
  near(byId.kiroKonductor.quality - byId.kiroVanilla.quality, 6);
  near(res.contrasts.kiroEffect.delta, 6);
  near(res.contrasts.ccEffect.delta, 9);
  near(res.contrasts.harnessVanilla.delta, 3);
  near(res.contrasts.harnessKonductor.delta, 6);
  near(res.contrasts.interaction.delta, 3);
  assert.equal(res.descriptive, true);
  assert.equal(res.descriptiveReason, 'descriptive only: n=1 per task');
  assert.ok(Object.values(res.contrasts).every((c) => c.interval === null && c.k === 5));
  near(res.costRatios.kiro.perRun, 3);
  near(res.costRatios.cc.perRun, 5);
  assert.deepEqual([res.costRatios.kiro.unit, res.costRatios.cc.unit], ['credits', 'USD']);
  near(byId.kiroKonductor.delegation.meanSpawns, 2);
  near(byId.ccKonductor.delegation.meanSpawns, 3);
  assert.equal(byId.kiroVanilla.delegation.share, 0);
  assert.equal(byId.ccKonductor.delegation.share, 1);
  assert.equal(res.model, 'claude-sonnet-5-5');
  assert.deepEqual(res.judges.panel, PANEL);
  const md = toMarkdown(renderFactorial(res));
  assert.match(md, /descriptive only: n=1 per task/);
  assert.doesNotMatch(md, /\[[-+]\d/);
  assert.match(md, /Credits and USD are different units/);
  assert.match(md, /\| Kiro CLI \| credits \| 1\.00 \| 3\.00 \| 3\.00x \| 3\.00x \|/);
  assert.match(md, /\| Claude Code \| USD \| 0\.02 \| 0\.10 \| 5\.00x \| 5\.00x \|/);
});

test('five tasks with two replicates in every cell give paired intervals', () => {
  const root = tmp();
  const bench = benchWith(root);
  const res = build(bench, four(root, bench, { all: { reps: 2 } }));
  assert.equal(res.descriptive, false);
  assert.equal(res.replicates.min, 2);
  for (const c of Object.values(res.contrasts)) {
    assert.ok(c.interval, c.label);
    assert.ok(c.interval.low <= c.delta && c.delta <= c.interval.high);
    assert.equal(c.interval.df, 4);
  }
  const md = toMarkdown(renderFactorial(res));
  assert.match(md, /Intervals are paired by task/);
  assert.match(md, /\[\+?[-\d.]+, \+?[-\d.]+\] at 95%/);
});

test('with fewer than five tasks of two replicates the table stays descriptive and says why', () => {
  const root = tmp();
  const bench = benchWith(root);
  const single = build(bench, four(root, bench, { all: { reps: 2 }, cv: { reps: 1 } }));
  assert.equal(single.descriptive, true);
  assert.equal(single.descriptiveReason, 'descriptive only: n=1 per task');
  const lost = build(bench, four(root, bench, { all: { reps: 2 }, kv: { extra: (t, rep) => (t === 't5' && rep === 2 ? { infraError: 'x' } : {}) } }));
  assert.equal(lost.descriptive, true);
  assert.match(lost.descriptiveReason, /fewer than 5 tasks have 2 or more scored replicates in every cell \(4\)/);
  assert.ok(Object.values(lost.contrasts).every((c) => c.interval === null));
});

test('a timed-out run is kept in the mean, marked, and dropped in the excluding-timeouts row', () => {
  const root = tmp();
  const bench = benchWith(root);
  const res = build(bench, four(root, bench, { kk: { status: (t) => (t === 't3' ? 'timeout' : 'success') } }));
  const kk = res.cells.find((c) => c.id === 'kiroKonductor');
  assert.equal(kk.timeouts, 1);
  assert.equal(kk.byTask.t3.timeouts, 1);
  assert.ok(kk.qualityExclTimeouts > kk.quality - 1e-9);
  assert.equal(kk.success, 4);
  const md = toMarkdown(renderFactorial(res));
  assert.match(md, /1 timeout\]/);
  assert.match(md, /mean excluding timed-out runs/);
  assert.match(res.notes.join('\n'), /Timed-out runs stay in every mean/);
});

test('cells with different task sets are refused and the message names what is missing', () => {
  const root = tmp();
  const bench = benchWith(root);
  const dirs = four(root, bench, { ck: { tasks: TASKS.slice(0, 4) } });
  assert.throws(() => build(bench, dirs), /do not hold the same tasks: ccKonductor lacks t5/);
});

test('cells judged by different panels, backends or model ids are refused', () => {
  const root = tmp();
  const bench = benchWith(root);
  assert.throws(() => build(bench, four(root, bench, { cv: { panel: ['glm-5', 'gpt-5.6-luna'] } })), /judge panel differs/);
  assert.throws(() => build(bench, four(root, bench, { cv: { models: { ...MODELS, 'glm-5': { bedrockModelId: 'zai.glm-5-b' } } } })), /judge model ids differ/);
  const dirs = four(root, bench);
  const file = path.join(dirs.kiroKonductor[0], 'judgments.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...j, backend: 'kiro' }));
  assert.throws(() => build(bench, dirs), /judge backend differs/);
});

test('a task judged against a different rubric revision in one cell is refused', () => {
  const root = tmp();
  const bench = benchWith(root);
  const loaded = loadTasks(bench);
  assert.throws(() => build(bench, four(root, bench, { ck: { revisionOf: (t) => (t === 't2' ? 'deadbeef0000' : taskRevision(loaded.get(t))) } })), /task t2 was judged against different rubric revisions/);
});

test('an unjudged cell, a wrong harness, a wrong arm and different models are refused', () => {
  const root = tmp();
  const bench = benchWith(root);
  assert.throws(() => build(bench, four(root, bench, { kv: { judged: false } })), /cell kiroVanilla.*not judged/);
  const d = four(root, bench);
  assert.throws(() => build(bench, { ...d, kiroVanilla: d.ccVanilla }), /cell kiroVanilla.*expected a kiro-cli run directory, found claude-code/);
  assert.throws(() => build(bench, { ...d, ccKonductor: d.kiroKonductor }), /cell ccKonductor.*expected a claude-code run directory/);
  assert.throws(() => build(bench, { ...d, kiroKonductor: d.kiroVanilla }), /a konductor cell needs a konductor arm/);
  assert.throws(() => build(bench, { ...d, kiroVanilla: d.kiroKonductor }), /expected vanilla/);
  assert.throws(() => build(bench, four(root, bench, { ck: { model: 'us.anthropic.claude-opus-5' } })), /model differs/);
  assert.throws(() => build(bench, { ...d, ccVanilla: [] }), /cell ccVanilla.*no run directory given/);
});

test('the two konductor cells must come from the same commit, and an unrecorded commit is noted', () => {
  const root = tmp();
  const bench = benchWith(root);
  assert.throws(() => build(bench, four(root, bench, { ck: { sha: '1234567890abcdef000000000000000000000000' } })), /built from different commits/);
  const res = build(bench, four(root, bench, { ck: { sha: null } }));
  assert.match(res.notes.join('\n'), /source commit of a konductor cell is not recorded/);
});

test('a cell with two arms is refused', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const other = cell(root, bench, 'kk2', { kind: 'kiro', arm: 'other', sha: SHA });
  fs.cpSync(path.join(other, 'other'), path.join(d.kiroKonductor[0], 'other'), { recursive: true });
  assert.throws(() => build(bench, d), /exactly one arm per cell is expected, found konductor, other/);
});

test('several run directories of one cell are merged, as report does', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const a = cell(root, bench, 'kv-a', { kind: 'kiro', arm: 'vanilla', tasks: ['t1', 't2', 't3'], rubric: (t) => 0.5 + OFFSET[t] });
  const b = cell(root, bench, 'kv-b', { kind: 'kiro', arm: 'vanilla', tasks: ['t4', 't5'], rubric: (t) => 0.5 + OFFSET[t] });
  const res = build(bench, { ...d, kiroVanilla: [a, b] });
  assert.equal(res.tasks.length, 5);
  assert.equal(res.replicates.min, 1);
});

test('reading leaves every run directory untouched', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const snap = () => Object.values(d).flat().map((dir) => spawnSync('find', [dir, '-type', 'f', '-printf', '%p %s %T@\n'], { encoding: 'utf8' }).stdout).join('');
  const before = snap();
  build(bench, d);
  assert.equal(snap(), before);
});

test('model ids from both harnesses collapse to one canonical name', () => {
  assert.equal(canonicalModel('claude-sonnet-5.5'), 'claude-sonnet-5-5');
  assert.equal(canonicalModel('us.anthropic.claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(canonicalModel('global.anthropic.claude-sonnet-5-5'), 'claude-sonnet-5-5');
  assert.equal(canonicalModel(undefined), 'unknown');
});

// ---- the command ----

function cli(args) {
  return spawnSync(process.execPath, [BENCH_JS, 'report-2x2', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR } });
}
const flags = (bench, d) => ['--kiro-vanilla', d.kiroVanilla.join(','), '--kiro-konductor', d.kiroKonductor.join(','), '--cc-vanilla', d.ccVanilla.join(','), '--cc-konductor', d.ccKonductor.join(','), '--bench-dir', bench];

test('report-2x2 prints markdown, prints JSON with --json, and writes both files to --out', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const md = cli(flags(bench, d));
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /^# 2x2 pilot: harness by konductor/);
  const js = cli([...flags(bench, d), '--json']);
  assert.equal(js.status, 0, js.stderr);
  assert.equal(JSON.parse(js.stdout).kind, 'factorial-2x2');
  const out = path.join(root, 'out');
  const w = cli([...flags(bench, d), '--out', out]);
  assert.equal(w.status, 0, w.stderr);
  assert.deepEqual(fs.readdirSync(out).sort(), ['factorial-2x2.json', 'factorial-2x2.md']);
  assert.equal(fs.readFileSync(path.join(out, 'factorial-2x2.md'), 'utf8'), `${md.stdout.trimEnd()}\n`);
});

test('report-2x2 exits 2 with a clear message for a missing flag, a refused input and an unknown flag', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const missing = cli(flags(bench, d).filter((a, i, all) => a !== '--cc-vanilla' && all[i - 1] !== '--cc-vanilla'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--cc-vanilla is required/);
  const bad = cli(flags(bench, { ...d, kiroVanilla: d.ccVanilla }));
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /report-2x2: cell kiroVanilla/);
  const typo = cli([...flags(bench, d), '--kiro-vanila', 'x']);
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /unknown flag --kiro-vanila/);
});
