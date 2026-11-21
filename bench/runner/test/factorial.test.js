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
const { buildFactorial, renderFactorial, factorialCharts, canonicalModel } = require('../../report/factorial.js');
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

const LISTING = (o = {}) => ({ harness: 'claude-code', budgetChars: 30000, listingChars: 28185, skillsSent: 92, konductorDescribed: ['a', 'b'], konductorNameOnly: [], nameOnly: 0, sopsModelInvocable: false, ...o });

test('the header shows each cell\'s skill listing, and a konductor cell with a name-only konductor skill is refused', () => {
  const root = tmp();
  try {
    const bench = benchWith(root);
    const kiroRec = { ...LISTING({ harness: 'kiro-cli', budgetChars: null, listingChars: null, skillsSent: 2 }), sopsModelInvocable: true };
    const ok = four(path.join(root, 'ok'), bench, { kk: { extra: () => ({ skillListing: kiroRec }) }, ck: { extra: () => ({ skillListing: LISTING(), claudeCode: { canonicalModel: 'claude-sonnet-5-5', modelsSeen: ['claude-sonnet-5-5'], spawned: 3, skillListing: LISTING() } }) } });
    const md = toMarkdown(renderFactorial(build(bench, ok)));
    assert.match(md, /## Skill listing/);
    assert.match(md, /\| Claude Code konductor \| 92 \| 2 \| 0 \| 28185 \| 30000 \| no \| 0 \|/);
    assert.match(md, /\| Kiro CLI konductor \| 2 \| 2 \| 0 \| n\/a \| no known cap \| yes \| 0 \|/);
    assert.match(md, /\| Kiro CLI vanilla \| not recorded \|/, 'a run from before the record is shown as not recorded');
    const cut = LISTING({ listingChars: 33894, overBudget: true, konductorNameOnly: ['verification', 'workspace-skills'], nameOnly: 2 });
    const bad = four(path.join(root, 'bad'), bench, { ck: { extra: () => ({ skillListing: cut }) } });
    assert.throws(() => build(bench, bad), /2 konductor skill\(s\) by name only in the claude-code skill listing \(33894 chars > 30000 budget: verification, workspace-skills\)/);
    // A vanilla cell (and a konductor one) whose runs listed the owner's own skills is refused too.
    const leaked = four(path.join(root, 'leak'), bench, { cv: { extra: () => ({ skillListing: LISTING({ konductorDescribed: [], otherDescribed: 25, otherNameOnly: 0, otherSkills: ['aws-cdk (Project)'] }) }) } });
    assert.throws(() => build(bench, leaked), /ccVanilla \(Claude Code vanilla\): 5 run\(s\) listed 25 skill\(s\) that are neither built-in nor the arm's .*TMPDIR outside HOME/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
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

test('every cell must run at one effort level: a Claude Code cell at "default" next to Kiro at high is refused, the same level is shown', () => {
  const root = tmp();
  const bench = benchWith(root);
  const high = { extra: () => ({ effort: 'high' }) };
  const old = { extra: () => ({ effort: 'default' }) };
  assert.throws(() => build(bench, four(root, bench, { all: high, cv: old, ck: old })), /effort differs: kiroVanilla ran at high, ccVanilla at default/);
  assert.throws(() => build(bench, four(root, bench, { all: high, kv: { extra: (t) => ({ effort: t === 't1' ? 'max' : 'high' }) } })), /cell kiroVanilla.*more than one effort level \(high, max\)/);
  const res = build(bench, four(root, bench, { all: high }));
  assert.equal(res.effort, 'high');
  assert.ok(res.cells.every((c) => c.effort === 'high'));
  assert.match(toMarkdown(renderFactorial(res)), /effort high in every cell/);
});

test('the two konductor cells must come from one recorded commit each', () => {
  const root = tmp();
  const bench = benchWith(root);
  assert.throws(() => build(bench, four(root, bench, { ck: { sha: '1234567890abcdef000000000000000000000000' } })), /built from different commits/);
  assert.throws(() => build(bench, four(root, bench, { ck: { sha: null } })), /cell ccKonductor.*no source commit is recorded/);
  const d = four(root, bench);
  const second = cell(root, bench, 'kk-b', { kind: 'kiro', arm: 'konductor', rubric: () => 0.5, sha: '1234567890abcdef000000000000000000000000' });
  const merged = { ...d, kiroKonductor: [d.kiroKonductor[0], second] };
  assert.throws(() => build(bench, merged), /cell kiroKonductor.*built from more than one commit/);
});

test('a run judged by only part of the panel is refused', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const file = path.join(d.ccVanilla[0], 'judgments.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dropped = j.rubric.findIndex((x) => x.taskId === 't2' && x.judge === 'glm-5');
  j.rubric.splice(dropped, 1);
  fs.writeFileSync(file, JSON.stringify(j));
  assert.throws(() => build(bench, d), /cell ccVanilla.*1 run\(s\) were scored by only part of the panel of 3 judges \(t2 rep 1\)/);
});

test('a cell with two arms is refused', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const other = cell(root, bench, 'kk2', { kind: 'kiro', arm: 'other', sha: SHA });
  fs.cpSync(path.join(other, 'other'), path.join(d.kiroKonductor[0], 'other'), { recursive: true });
  assert.throws(() => build(bench, d), /exactly one arm per cell is expected, found konductor, other/);
});

test('the refusal of a cell with two arms says how to pick one', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const other = cell(root, bench, 'kk2', { kind: 'kiro', arm: 'other', sha: SHA });
  fs.cpSync(path.join(other, 'other'), path.join(d.kiroKonductor[0], 'other'), { recursive: true });
  assert.throws(() => build(bench, d), /Pick one with --kiro-konductor DIR:ARM or --cell kiroKonductor=DIR:ARM/);
});

// One Kiro directory with three arms, as a multi-arm `bench.js run` leaves it: each Kiro cell picks its arm from it.
function multiArmKiro(root, bench) {
  const d = four(root, bench);
  const shared = path.join(root, 'kiro-multi');
  fs.cpSync(d.kiroKonductor[0], shared, { recursive: true });
  const extra = cell(root, bench, 'combo-src', { kind: 'kiro', arm: 'combo', sha: SHA, rubric: () => 0.9 });
  fs.cpSync(path.join(extra, 'combo'), path.join(shared, 'combo'), { recursive: true });
  fs.cpSync(path.join(d.kiroVanilla[0], 'vanilla'), path.join(shared, 'vanilla'), { recursive: true });
  const j = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'judgments.json'), 'utf8'));
  const merged = j(shared);
  merged.rubric = [...merged.rubric, ...j(extra).rubric, ...j(d.kiroVanilla[0]).rubric];
  fs.writeFileSync(path.join(shared, 'judgments.json'), JSON.stringify(merged));
  return { d, shared };
}

test('an arm selector lets two cells read their arms from one directory that holds several', () => {
  const root = tmp();
  const bench = benchWith(root);
  const { d, shared } = multiArmKiro(root, bench);
  assert.throws(() => build(bench, { ...d, kiroVanilla: [shared] }), /exactly one arm per cell is expected, found combo, konductor, vanilla/);
  const ref = build(bench, d);
  const res = buildFactorial({ dirs: { ...d, kiroVanilla: [shared], kiroKonductor: [shared] }, arms: { kiroVanilla: 'vanilla', kiroKonductor: 'konductor' }, benchDir: bench });
  assert.deepEqual(res.cells.map((c) => c.quality), ref.cells.map((c) => c.quality));
  const combo = buildFactorial({ dirs: { ...d, kiroKonductor: [shared] }, arms: { kiroKonductor: 'combo' }, benchDir: bench });
  near(combo.cells.find((c) => c.id === 'kiroKonductor').quality, 40 + 60 * 0.9);
});

test('an arm selector that names an arm the directory does not hold is refused with the arms it does hold', () => {
  const root = tmp();
  const bench = benchWith(root);
  const { d, shared } = multiArmKiro(root, bench);
  assert.throws(() => buildFactorial({ dirs: { ...d, kiroKonductor: [shared] }, arms: { kiroKonductor: 'nope' }, benchDir: bench }), /cell kiroKonductor .*: arm nope is not in the run directory; it holds combo, konductor, vanilla/);
  assert.throws(() => buildFactorial({ dirs: { ...d, kiroVanilla: [shared] }, arms: { kiroVanilla: 'combo' }, benchDir: bench }), /the arm is combo, expected vanilla/);
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

test('report-2x2 prints markdown, prints JSON with --json, and writes the files and charts to --out', () => {
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
  assert.deepEqual(fs.readdirSync(out).sort(), ['charts', 'factorial-2x2.json', 'factorial-2x2.md']);
  assert.equal(fs.readFileSync(path.join(out, 'factorial-2x2.md'), 'utf8'), `${w.stdout.trimEnd()}\n`);
});

test('report-2x2 reads DIR:ARM on a cell flag and --cell ID=DIR:ARM, and gives the same table either way', () => {
  const root = tmp();
  const bench = benchWith(root);
  const { d, shared } = multiArmKiro(root, bench);
  const ref = cli([...flags(bench, d), '--json']);
  assert.equal(ref.status, 0, ref.stderr);
  const quality = (r) => JSON.parse(r.stdout).cells.map((c) => c.quality);
  const suffix = cli([...flags(bench, { ...d, kiroVanilla: [`${shared}:vanilla`], kiroKonductor: [`${shared}:konductor`] }), '--json']);
  assert.equal(suffix.status, 0, suffix.stderr);
  assert.deepEqual(quality(suffix), quality(ref));
  const noKiro = flags(bench, d).filter((a, i, all) => !/^--kiro-/.test(a) && !/^--kiro-/.test(all[i - 1] ?? ''));
  const viaCell = cli([...noKiro, '--cell', `kiroVanilla=${shared}:vanilla`, '--cell', `kiro-konductor=${shared}:konductor`, '--json']);
  assert.equal(viaCell.status, 0, viaCell.stderr);
  assert.deepEqual(quality(viaCell), quality(ref));
  const unpicked = cli(flags(bench, { ...d, kiroVanilla: [shared] }));
  assert.equal(unpicked.status, 2);
  assert.match(unpicked.stderr, /found combo, konductor, vanilla\. Pick one with --kiro-vanilla DIR:ARM/);
});

test('report-2x2 refuses a bad --cell: an unknown id, a cell given twice, and a cell given by both forms', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const bad = cli([...flags(bench, d), '--cell', `nope=${d.kiroVanilla[0]}`]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--cell nope=.*the cell id before "=" is one of kiroVanilla/);
  const both = cli([...flags(bench, d), '--cell', `kiroVanilla=${d.kiroVanilla[0]}`]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /cell kiroVanilla is given by both --kiro-vanilla and --cell/);
  const twice = cli([...flags(bench, d).slice(2), '--cell', `kiroVanilla=${d.kiroVanilla[0]}`, '--cell', `kiroVanilla=${d.kiroVanilla[0]}`]);
  assert.equal(twice.status, 2);
  assert.match(twice.stderr, /cell kiroVanilla is given more than once/);
  const badArm = cli(flags(bench, { ...d, kiroVanilla: [`${d.kiroVanilla[0]}:Not/An-Arm`] }));
  assert.equal(badArm.status, 2);
  assert.match(badArm.stderr, /is not an arm id/);
});

test('a directory whose name holds a colon is still read as a directory', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const colon = `${d.kiroVanilla[0]}:copy`;
  fs.cpSync(d.kiroVanilla[0], colon, { recursive: true });
  const r = cli(flags(bench, { ...d, kiroVanilla: [colon] }));
  assert.equal(r.status, 0, r.stderr);
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

const CHARTS = ['quality-by-cell', 'konductor-effect', 'cost-ratio'];
const count = (svg, re) => (svg.match(re) ?? []).length;

test('report-2x2 --out writes three valid SVG charts and the markdown links them', () => {
  const root = tmp();
  const bench = benchWith(root);
  const out = path.join(root, 'out');
  const w = cli([...flags(bench, four(root, bench)), '--out', out]);
  assert.equal(w.status, 0, w.stderr);
  assert.deepEqual(fs.readdirSync(path.join(out, 'charts')).sort(), CHARTS.map((n) => `${n}.svg`).sort());
  for (const name of CHARTS) {
    const svg = fs.readFileSync(path.join(out, 'charts', `${name}.svg`), 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<\/svg>\n$/);
    assert.doesNotMatch(svg, /NaN|undefined|<script|href=/);
    assert.match(w.stdout, new RegExp(`\\(charts/${name}\\.svg\\)`));
  }
  const md = fs.readFileSync(path.join(out, 'factorial-2x2.md'), 'utf8');
  assert.match(md, /!\[Quality by cell[^\]]*\]\(charts\/quality-by-cell\.svg\)/);
  const bare = cli(flags(bench, four(root, bench)));
  assert.doesNotMatch(bare.stdout, /charts\//);
});

test('at n=1 the charts say descriptive only and draw no interval whiskers', () => {
  const root = tmp();
  const bench = benchWith(root);
  const charts = factorialCharts(build(bench, four(root, bench)));
  assert.deepEqual([...charts.keys()], CHARTS);
  for (const svg of charts.values()) assert.equal(count(svg, /data-role="ci"/g), 0);
  assert.match(charts.get('quality-by-cell'), /descriptive only: n=1 per task/);
  assert.match(charts.get('konductor-effect'), /descriptive only: n=1 per task/);
  assert.match(charts.get('cost-ratio'), /descriptive only: n=1 per task/);
  assert.equal(count(charts.get('quality-by-cell'), /data-role="bar"/g), 4);
  assert.equal(count(charts.get('quality-by-cell'), /data-role="dot"/g), 4 * TASKS.length);
  assert.equal(count(charts.get('konductor-effect'), /data-role="bar"/g), 2);
});

test('with intervals on, only the effect chart draws whiskers and the subtitle drops the warning', () => {
  const root = tmp();
  const bench = benchWith(root);
  const charts = factorialCharts(build(bench, four(root, bench, { all: { reps: 2 } })));
  assert.equal(count(charts.get('konductor-effect'), /data-role="ci"/g), 2);
  assert.equal(count(charts.get('quality-by-cell'), /data-role="ci"/g), 0);
  assert.equal(count(charts.get('cost-ratio'), /data-role="ci"/g), 0);
  for (const svg of charts.values()) assert.doesNotMatch(svg, /descriptive only/);
  assert.match(charts.get('konductor-effect'), /95% interval, paired by task/);
});

test('credits and USD never share an axis: cost is plotted only as a ratio, with each unit in its own label', () => {
  const root = tmp();
  const bench = benchWith(root);
  const svg = factorialCharts(build(bench, four(root, bench))).get('cost-ratio');
  assert.match(svg, />Kiro CLI \(credits\)</);
  assert.match(svg, />Claude Code \(USD\)</);
  assert.match(svg, />ratio per run \(1 = same cost\)</);
  const axis = (svg.match(/<text[^>]*transform="rotate\(-90[^>]*>([^<]*)</) ?? [])[1];
  assert.doesNotMatch(axis, /credits|USD/);
  const labels = (svg.match(/<text[^>]*font-size="9"[^>]*>([^<]*)</g) ?? []).join(' ');
  assert.match(labels, />3</);
  assert.match(labels, />5</);
  assert.doesNotMatch(labels, /0\.02|0\.1</);
});

test('a missing cost ratio or contrast is left off the chart instead of drawn as zero', () => {
  const root = tmp();
  const bench = benchWith(root);
  const res = build(bench, four(root, bench));
  res.costRatios.cc.perRun = null;
  res.contrasts.kiroEffect.delta = null;
  const charts = factorialCharts(res);
  assert.equal(count(charts.get('cost-ratio'), /data-role="bar"/g), 1);
  assert.equal(count(charts.get('konductor-effect'), /data-role="bar"/g), 1);
});

test('the 2x2 page names the evidence-quote rule and shows the cells under both rules', () => {
  const root = tmp();
  try {
    const bench = benchWith(root);
    const res = buildFactorial({ dirs: four(root, bench), benchDir: bench });
    assert.equal(res.quote.requested, 'paraphrase', 'paraphrase is the default since 2026-11-20');
    assert.equal(res.sensitivity.available, true);
    assert.equal(res.sensitivity.other, 'lenient');
    assert.equal(res.sensitivity.cells.length, 4);
    const md = toMarkdown(renderFactorial(res));
    assert.match(md, /Evidence-quote rule: paraphrase \(lenient, or a restatement whose figures and most content words are in the output\)\. Lenient sensitivity: see the table below\./);
    assert.match(md, /Quality per cell under both quote rules \(paraphrase is the one in use\)/);
    const strict = buildFactorial({ dirs: four(root, bench), benchDir: bench, scoringFile: path.join(__dirname, '..', '..', 'profiles', 'scoring-strict-quotes.json') });
    assert.equal(strict.quote.requested, 'strict');
    assert.match(toMarkdown(renderFactorial(strict)), /Evidence-quote rule: strict \(every segment between ellipses/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('report-2x2 --prereg accepts tasks that match the lock and refuses a task that is not in it or has changed', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  // The pack: the five tasks move out of the bench into a batch directory and get a version, as scenario tasks have.
  const batch = path.join(root, 'pack', 'b1');
  for (const id of TASKS) {
    const file = path.join(bench, 'tasks', `${id}.json`);
    write(path.join(batch, `${id}.json`), JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), version: 1 }));
    fs.rmSync(file);
  }
  // freeze runs the lint and the coverage gate on a konductor tree first (D-55); an empty one, with the gaps accepted.
  const tree = path.join(root, 'konductor-tree');
  fs.mkdirSync(path.join(tree, 'skills'), { recursive: true });
  const freeze = spawnSync(process.execPath, [BENCH_JS, 'scenarios', 'prereg', 'freeze', path.join(root, 'pack'), '--date', '2026-11-19', '--base', `dir:${tree}`, '--accept-gaps', 'a test pack'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: tmp(), TMPDIR: process.env.TMPDIR } });
  assert.equal(freeze.status, 0, freeze.stderr);
  const lock = path.join(root, 'pack', 'PREREG.json');
  const args = [...flags(bench, d), '--extra-tasks', batch, '--prereg', lock];
  const ok = cli(args);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^# 2x2 pilot/);
  const t = JSON.parse(fs.readFileSync(path.join(batch, 't2.json'), 'utf8'));
  write(path.join(batch, 't2.json'), JSON.stringify({ ...t, prompt: 'changed after the lock' }));
  const bad = cli(args);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /report-2x2: the run does not match the pre-registration lock[\s\S]*t2: the task file differs/);
  assert.equal(bad.stdout, '');
});

test('report-2x2 --stats adds the pre-registered statistic from HELD-OUT tasks, with DEV shown apart, and the default output has no such section', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  const plain = cli(flags(bench, d));
  assert.doesNotMatch(plain.stdout, /Pre-registered statistic/);
  const res = cli([...flags(bench, d), '--stats', '--json']);
  assert.equal(res.status, 0, res.stderr);
  const paired = JSON.parse(res.stdout).paired;
  assert.equal(paired.margin, 5);
  assert.equal(paired.draws, 10000);
  const { splitOf } = require('../../scenarios/split.js');
  const held = TASKS.filter((t) => splitOf(t) === 'HELD-OUT').length;
  assert.deepEqual(paired.harnesses.map((h) => [h.id, h.taskCounts.heldOut, h.taskCounts.dev]), [['kiro', held, TASKS.length - held], ['cc', held, TASKS.length - held]]);
  assert.equal(paired.harnesses[0].heldOut.n, held);
  const md = cli([...flags(bench, d), '--stats']);
  assert.match(md.stdout, /## Pre-registered statistic: konductor minus vanilla, two-level bootstrap/);
  assert.match(md.stdout, /DEV \(\d+\), not a verdict/);
});

test('report-2x2 shows the run level recorded in the cells\' run-config in its header, and nothing when none is recorded', () => {
  const root = tmp();
  const bench = benchWith(root);
  const d = four(root, bench);
  assert.doesNotMatch(cli(flags(bench, d)).stdout, /Run level/);
  const level = { name: 'lite', taskCount: 16, listHash: 'ab'.repeat(32), smokeOnly: [], unfilledRoles: [], picks: [], tasks: [] };
  for (const dir of Object.values(d).flat()) {
    const file = path.join(dir, 'run-config.json');
    write(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), level }));
  }
  const res = cli(flags(bench, d));
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /Run level: LITE, 16 tasks \(list abababababab\)\. LITE is a smoke test/);
  assert.match(JSON.parse(cli([...flags(bench, d), '--json']).stdout).runLevel, /^Run level: LITE/);
});
