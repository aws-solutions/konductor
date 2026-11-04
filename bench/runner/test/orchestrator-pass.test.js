// SPDX-License-Identifier: Apache-2.0
'use strict';

// report --verdict orchestrator-pass: per (harness, model) cell, the test arm passes when it costs at most 2.0x vanilla and
// its quality is not worse than vanilla by more than vanilla's per-run quality spread. Fixture runs only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixtureRun, mk, TASKS6 } = require('./verdict-fixtures.js');
const op = require('../../report/orchpass.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const Q = (h) => ((0.5 * (h / 10) + 0.2) / 0.7) * 100;

// ---- the decision, from plain numbers ----

const ok = () => ({
  nHead: 30, nBase: 30, cells: 6, qualityDelta: 8, qualityCiLow: 1, qualityCiHigh: 15, withinSd: 4, baseSd: 4, qualityDrift: 1, costRunRatio: 1.5, costSuccessRatio: 1.5, costDrift: 0.02, hasAA: true, target: null,
  nonScored: { head: { n: 0, total: 30 }, base: { n: 0, total: 30 } }, components: { ok: true }, costBound: null,
});

test('a cell within both limits and clear of drift passes', () => {
  const r = op.decideCell(ok());
  assert.equal(r.call, op.PASS);
  assert.equal(r.cost.status, 'pass');
  assert.equal(r.quality.status, 'pass');
});

test('cost: exactly 2.0x passes, anything above fails, and the cost per successful run counts too', () => {
  assert.equal(op.decideCell({ ...ok(), costRunRatio: 2, costSuccessRatio: 2 }).call, op.PASS);
  assert.equal(op.decideCell({ ...ok(), costRunRatio: 2.0000001, costSuccessRatio: 1.5 }).call, op.FAIL);
  assert.equal(op.decideCell({ ...ok(), costRunRatio: 1.5, costSuccessRatio: 2.01 }).call, op.FAIL);
  assert.equal(op.decideCell({ ...ok(), costRunRatio: 1.5, costSuccessRatio: Infinity }).call, op.FAIL, 'no clean pass at all');
  const r = op.decideCell({ ...ok(), costRunRatio: 3 });
  assert.match(r.reasons.join(' '), /costs 3\.00x/);
});

test('quality: the tolerance is the within-task spread of vanilla, never below 5 points', () => {
  assert.equal(op.QUALITY_FLOOR_PTS, 5);
  const at = (delta, ciLow, withinSd) => op.decideCell({ ...ok(), qualityDelta: delta, qualityCiLow: ciLow, qualityCiHigh: delta + 10, withinSd, qualityDrift: null });
  assert.equal(at(-3, -5, 4).call, op.PASS, 'a spread of 4 is lifted to the 5-point floor, and the interval bottom sits on it');
  assert.equal(at(-3, -5.01, 4).call, op.NEE, 'the interval reaches below the tolerance');
  assert.equal(at(-7, -8, 8).call, op.PASS, 'a wider spread of 8 sets the tolerance');
  assert.equal(at(-8.01, -12, 8).call, op.FAIL, 'the point estimate is below the tolerance');
  assert.equal(at(30, 20, 0).call, op.PASS, 'a gain passes, the floor applies to a zero spread');
  assert.equal(at(-0.0001, -6, 0).call, op.NEE, 'a zero spread no longer allows a free pass: the interval must clear the floor');
});

test('quality: a drop of 29 points does not pass on a pooled spread of 30, because the spread is within a task', () => {
  const r = op.decideCell({ ...ok(), qualityDelta: -29, qualityCiLow: -41, qualityCiHigh: -17, withinSd: 11, baseSd: 30, qualityDrift: 1 });
  assert.equal(r.call, op.FAIL);
  assert.match(r.reasons.join(' '), /quality is below vanilla by 29\.0 points, more than the tolerance of 11\.0 points/);
});

test('quality: a point estimate inside the tolerance with an interval that reaches below it is NOT ENOUGH EVIDENCE, not a pass', () => {
  const r = op.decideCell({ ...ok(), qualityDelta: 2, qualityCiLow: -20, qualityCiHigh: 24, withinSd: 8, qualityDrift: 1 });
  assert.equal(r.call, op.NEE);
  assert.equal(r.quality.status, 'uncertain');
  assert.equal(r.rawPass, false);
  assert.match(r.reasons.join(' '), /interval of the quality difference \[-20\.0, 24\.0\] reaches below the tolerance of -8\.0 points/);
});

test('drift as large as the effect makes the criterion uncertain and the cell NOT ENOUGH EVIDENCE; the drift is at least the 5-point floor', () => {
  const q = op.decideCell({ ...ok(), qualityDelta: 6, qualityCiLow: 2, qualityCiHigh: 10, qualityDrift: 6 });
  assert.equal(q.call, op.NEE);
  assert.equal(q.quality.status, 'uncertain');
  assert.match(q.reasons.join(' '), /A\/A drift of 6\.0 points is not smaller than the quality difference of 6\.0/);
  const floor = op.decideCell({ ...ok(), qualityDelta: 4.9, qualityCiLow: 1, qualityCiHigh: 9, qualityDrift: 0.1 });
  assert.equal(floor.call, op.NEE, 'a measured drift of 0.1 is read as the 5-point floor');
  assert.match(floor.reasons.join(' '), /A\/A drift of 5\.0 points/);
  const c = op.decideCell({ ...ok(), costRunRatio: 1.09, costSuccessRatio: 1.09, costDrift: 0.1 });
  assert.equal(c.call, op.NEE);
  assert.equal(c.cost.status, 'uncertain');
  assert.equal(op.decideCell({ ...ok(), qualityDelta: 5.1, qualityCiLow: 1, qualityCiHigh: 9, qualityDrift: 2 }).call, op.PASS);
});

test('cost drift is compared with the effect at the boundary', () => {
  assert.equal(op.decideCell({ ...ok(), costRunRatio: 1.5, costSuccessRatio: 1.5, costDrift: 0.5 }).cost.status, 'uncertain');
  assert.equal(op.decideCell({ ...ok(), costRunRatio: 1.5, costSuccessRatio: 1.5, costDrift: 0.49 }).cost.status, 'pass');
});

test('a clear failure stands unless the evidence is short; global gaps always give NOT ENOUGH EVIDENCE', () => {
  assert.equal(op.decideCell({ ...ok(), costRunRatio: 3, costSuccessRatio: 3, qualityDelta: 1, qualityCiLow: -8, qualityDrift: 5 }).call, op.FAIL);
  for (const patch of [{ hasAA: false, qualityDrift: null, costDrift: null }, { nHead: 2 }, { nBase: 2 }, { withinSd: null }, { cells: 4 }, { target: { blocks: true, reason: 'skill x never loaded' } }]) {
    const r = op.decideCell({ ...ok(), costRunRatio: 3, costSuccessRatio: 3, ...patch });
    assert.equal(r.call, op.NEE, JSON.stringify(patch));
    assert.equal(r.rawPass, false, 'the thresholds are still reported');
  }
  assert.match(op.decideCell({ ...ok(), hasAA: false, qualityDrift: null, costDrift: null }).reasons.join(' '), /no A\/A repeat in this cell/);
  assert.match(op.decideCell({ ...ok(), nHead: 2 }).reasons.join(' '), /fewer than 3 scored runs/);
  assert.match(op.decideCell({ ...ok(), cells: 4 }).reasons.join(' '), /fewer than 5 paired task cells \(4\)/);
  assert.match(op.decideCell({ ...ok(), withinSd: null }).reasons.join(' '), /within-task spread is unknown/);
  assert.match(op.decideCell({ ...ok(), target: { blocks: true, reason: 'skill x never loaded' } }).reasons.join(' '), /skill x never loaded/);
});

test('an arm that lost half its runs to infra errors cannot pass on the other half', () => {
  const r = op.decideCell({ ...ok(), nonScored: { head: { n: 15, total: 30 }, base: { n: 0, total: 30 } } });
  assert.equal(r.call, op.NEE);
  assert.match(r.reasons.join(' '), /15 of 30 runs of the arm have no score .* over the 20% limit/);
  assert.equal(op.decideCell({ ...ok(), nonScored: { head: { n: 6, total: 30 }, base: { n: 0, total: 30 } } }).call, op.PASS, 'exactly a fifth is allowed');
  const base = op.decideCell({ ...ok(), nonScored: { head: { n: 0, total: 30 }, base: { n: 7, total: 30 } } });
  assert.equal(base.call, op.NEE);
  assert.match(base.reasons.join(' '), /7 of 30 runs of vanilla/);
});

test('arms scored on different components cannot pass', () => {
  const r = op.decideCell({ ...ok(), components: { ok: false, reason: 'the arm and vanilla were scored on different components in 1 cell(s) (t1: ...)' } });
  assert.equal(r.call, op.NEE);
  assert.match(r.reasons.join(' '), /different components/);
});

test('unmetered runs: a cost that passes on the metered runs but fails on the bound is NOT ENOUGH EVIDENCE, and one that fails on the metered runs still fails', () => {
  const bound = { censoredRuns: 4, runRatio: 2.4, successRatio: 2.6 };
  const r = op.decideCell({ ...ok(), costRunRatio: 1.5, costSuccessRatio: 1.6, costBound: bound });
  assert.equal(r.call, op.NEE);
  assert.equal(r.cost.status, 'uncertain');
  assert.match(r.reasons.join(' '), /4 run\(s\) of the arm have no metered cost and are counted at the largest metered cost of their task; on that bound it costs 2\.60x/);
  assert.equal(op.decideCell({ ...ok(), costRunRatio: 2.5, costSuccessRatio: 2.5, costBound: { censoredRuns: 4, runRatio: 3, successRatio: 3 } }).call, op.FAIL);
  assert.equal(op.decideCell({ ...ok(), costBound: { censoredRuns: 4, runRatio: 1.7, successRatio: 1.8 } }).call, op.PASS);
});

test('sampleSd is the n-1 standard deviation and null below two values', () => {
  assert.equal(op.sampleSd([2, 4, 4, 4, 5, 5, 7, 9]).toFixed(4), '2.1381');
  assert.equal(op.sampleSd([5]), null);
  assert.equal(op.sampleSd([]), null);
  assert.equal(op.sampleSd([3, 3, 3]), 0);
});

// ---- fixture runs ----

const CELL = { model: 'claude-sonnet-5.5', agentEngine: 'v3', harness: 'kiro-cli' };
const VAN = [7, 8, 9, 8, 8];

function cellDir(root, name, { model = CELL.model, vanilla = {}, orch = {}, aa = {}, extraArms = {}, noAA = false, reps = 5, tasks = TASKS6 }) {
  const meta = { model, agentEngine: 'v3', harness: 'kiro-cli' };
  const arms = {
    vanilla: { hidden: VAN, credits: 5, extra: meta, ...vanilla },
    orch: { sha: 'a', hidden: [9], credits: 8, extra: meta, ...orch },
    ...(noAA ? {} : { 'orch-b': { sha: 'a', hidden: [9], credits: 8, extra: meta, ...aa } }),
    ...extraArms,
  };
  return fixtureRun(root, name, { arms, reps, tasks, config: { model, agentEngine: 'v3', harness: 'kiro-cli' } });
}

const run = (dirs, o = {}) => op.buildOrchestratorPass({ dirs: [].concat(dirs).map((d) => d.dir), benchDir: [].concat(dirs)[0].benchDir, baseline: 'vanilla', ...o });
const armOf = (v, cellIdx, id) => v.cells[cellIdx].arms.find((a) => a.armId === id);

test('a cell that is cheaper than 2x, no worse in quality and clear of drift passes, and the A/A repeat gets no call', () => {
  const root = mk();
  try {
    const v = run(cellDir(root, 'c1', {}));
    assert.equal(v.cells.length, 1);
    assert.equal(v.cells[0].key, 'kiro-cli v3 / claude-sonnet-5.5');
    const a = armOf(v, 0, 'orch');
    assert.equal(a.call, op.PASS, a.reasons.join('; '));
    assert.equal(a.cost.ratioPerRun, 1.6);
    assert.equal(a.cost.ratioPerSuccess, 1.6);
    assert.ok(a.quality.delta > 5 && a.quality.delta < 9);
    assert.ok(a.quality.withinSd > 4 && a.quality.withinSd < 6, String(a.quality.withinSd));
    assert.equal(a.quality.tolerance, Math.max(a.quality.withinSd, op.QUALITY_FLOOR_PTS));
    assert.equal(a.quality.k, 6);
    assert.equal(armOf(v, 0, 'orch-b').call, null);
    assert.equal(armOf(v, 0, 'orch-b').aaRepeatOf, a.label);
    assert.equal(v.rule.costMax, 2);
  } finally { rm(root); }
});

test('a test arm over 2x the cost of vanilla fails the cell', () => {
  const root = mk();
  try {
    const v = run(cellDir(root, 'c2', { orch: { credits: 11 }, aa: { credits: 11 } }));
    const a = armOf(v, 0, 'orch');
    assert.equal(a.call, op.FAIL);
    assert.match(a.reasons.join(' '), /costs 2\.20x vanilla per run, over the 2\.0x limit/);
  } finally { rm(root); }
});

test('a quality drop larger than the within-task spread of vanilla fails; a drop inside it does not fail', () => {
  const root = mk();
  try {
    const bad = run(cellDir(root, 'c3', { orch: { hidden: [4] }, aa: { hidden: [4] } }));
    assert.equal(armOf(bad, 0, 'orch').call, op.FAIL);
    assert.match(armOf(bad, 0, 'orch').reasons.join(' '), /below vanilla by .* more than the tolerance of/);
    // vanilla mean is 8; an arm cycling 7,7,8,7,8 is about 4.3 points down, inside the 5.05-point tolerance, and its interval reaches below it
    const inside = run(cellDir(root, 'c4', { orch: { hidden: [7, 7, 8, 7, 8] }, aa: { hidden: [7, 7, 8, 7, 8] } }));
    const a = armOf(inside, 0, 'orch');
    assert.ok(a.quality.delta < 0 && -a.quality.delta < a.quality.tolerance, `${a.quality.delta} vs tolerance ${a.quality.tolerance}`);
    assert.notEqual(a.quality.status, 'fail');
  } finally { rm(root); }
});

test('A/A drift larger than the effect marks the cell NOT ENOUGH EVIDENCE', () => {
  const root = mk();
  try {
    // the arm is 1 hidden test (7 points) up; its A/A repeat is 1.5 tests up on the other side of the effect: drift 10.7 points
    const v = run(cellDir(root, 'c5', { orch: { hidden: [9] }, aa: { hidden: [7, 8, 7, 8, 7] } }));
    const a = armOf(v, 0, 'orch');
    assert.equal(a.call, op.NEE);
    assert.match(a.reasons.join(' '), /A\/A drift/);
    assert.equal(a.rawPass, true, 'the thresholds themselves are met; the evidence is what is missing');
  } finally { rm(root); }
});

test('no A/A repeat in the cell is NOT ENOUGH EVIDENCE', () => {
  const root = mk();
  try {
    const a = armOf(run(cellDir(root, 'c6', { noAA: true })), 0, 'orch');
    assert.equal(a.call, op.NEE);
    assert.match(a.reasons.join(' '), /no A\/A repeat in this cell/);
  } finally { rm(root); }
});

test('fewer than 3 runs per side is NOT ENOUGH EVIDENCE', () => {
  const root = mk();
  try {
    const a = armOf(run(cellDir(root, 'c7', { reps: 1, tasks: ['t1', 't2'] })), 0, 'orch');
    assert.equal(a.call, op.NEE);
    assert.match(a.reasons.join(' '), /fewer than 3 scored runs/);
  } finally { rm(root); }
});

test('an arm with no clean pass at all has an unbounded cost per successful run and fails on cost', () => {
  const root = mk();
  try {
    const v = run(cellDir(root, 'c8b', { orch: { fail: () => 'error', failNoScore: true }, aa: {} }));
    const a = armOf(v, 0, 'orch');
    assert.equal(a.cost.ratioPerSuccess, Infinity);
    assert.equal(a.cost.headCleanPasses, 0);
    assert.equal(a.call, op.FAIL);
    assert.match(a.reasons.join(' '), /no clean pass/);
  } finally { rm(root); }
});

test('failed runs are not dropped: a timed-out run of the test arm counts as quality 0 and in its cost', () => {
  const root = mk();
  try {
    const v = run(cellDir(root, 'c8', { orch: { fail: (k) => (k === 3 ? 'timeout' : null), failNoScore: true, credits: 8 }, aa: {} }));
    const a = armOf(v, 0, 'orch');
    assert.equal(a.failures.timeout, 1);
    assert.equal(a.failedAsZero, 1);
    assert.equal(a.quality.n, 30, 'the zero-scored run is in the quality count');
  } finally { rm(root); }
});

// ---- the review's cases, as runs ----

test('tasks of different difficulty do not widen the tolerance: a 14-point drop passed the pooled spread and fails the within-task one', () => {
  const root = mk();
  try {
    const meta = { model: CELL.model, agentEngine: 'v3', harness: 'kiro-cli' };
    const hard = [3, 4, 3, 3, 4];
    const easy = [9, 9, 10, 9, 9];
    const lower = (xs, n) => xs.map((h) => h - n);
    const byTask = (f) => Object.fromEntries(TASKS6.map((t, i) => [t, f(i % 2 ? hard : easy)]));
    const arms = {
      vanilla: { hiddenByTask: byTask((x) => x), credits: 5, extra: meta },
      orch: { sha: 'a', hiddenByTask: byTask((x) => lower(x, 2)), credits: 6, extra: meta },
      'orch-b': { sha: 'a', hiddenByTask: byTask((x) => lower(x, 2)), credits: 6, extra: meta },
    };
    const d = fixtureRun(root, 'diff', { arms, tasks: TASKS6, config: { model: CELL.model, agentEngine: 'v3', harness: 'kiro-cli' } });
    const a = armOf(run(d), 0, 'orch');
    assert.ok(a.quality.baseSd > 15, `the pooled spread is ${a.quality.baseSd}`);
    assert.ok(-a.quality.delta < a.quality.baseSd, 'the old rule would have passed this drop');
    assert.ok(a.quality.withinSd < 6, String(a.quality.withinSd));
    assert.equal(a.call, op.FAIL, a.reasons.join('; '));
  } finally { rm(root); }
});

test('an arm with most of its runs lost to stream-parse infra errors is NOT ENOUGH EVIDENCE, not a pass on the survivors', () => {
  const root = mk();
  try {
    const lost = { extraFn: (task, rep) => (rep <= 3 ? { infraError: 'stream parse failed' } : {}) };
    const a = armOf(run(cellDir(root, 'infra', { orch: lost })), 0, 'orch');
    assert.equal(a.call, op.NEE);
    assert.match(a.reasons.join(' '), /18 of 30 runs of the arm have no score/);
    assert.equal(a.nonScored.head.infraError, 18);
    assert.equal(a.failures.infraError, 18);
  } finally { rm(root); }
});

test('runs with no metered cost are counted at the task maximum when that decides the cost call', () => {
  const root = mk();
  try {
    const open = { credits: 11, extraFn: (task, rep) => (rep === 1 ? { credits: null, creditsCensored: true, creditsLowerBound: 0.5 } : {}) };
    const a = armOf(run(cellDir(root, 'open', { orch: open, aa: { credits: 11 } })), 0, 'orch');
    assert.ok(a.cost.ratioPerRun < 2, `metered runs only: ${a.cost.ratioPerRun}`);
    assert.equal(a.cost.bound.censoredRuns, 6);
    assert.equal(a.cost.bound.runRatio, 2.2);
    assert.equal(a.call, op.NEE);
    assert.match(a.reasons.join(' '), /6 run\(s\) of the arm have no metered cost/);
  } finally { rm(root); }
});

test('arms scored on different components in one task are NOT ENOUGH EVIDENCE', () => {
  const root = mk();
  try {
    const d = cellDir(root, 'comp', {});
    const dir = path.join(d.dir, 'orch', 't2');
    for (const rep of fs.readdirSync(dir)) {
      const f = path.join(dir, rep, 'result.json');
      const r = JSON.parse(fs.readFileSync(f, 'utf8'));
      r.hiddenTests = undefined;
      fs.writeFileSync(f, JSON.stringify(r));
    }
    const a = armOf(run(d), 0, 'orch');
    assert.equal(a.call, op.NEE);
    assert.match(a.reasons.join(' '), /different components in 1 cell\(s\) \(t2:/);
  } finally { rm(root); }
});

// ---- skills that never load ----

const skillMeta = (loaded) => ({ extraFn: () => ({ skillsLoaded: loaded.map((name) => ({ name, bytes: 10 })), changedSkills: { names: ['alpha'], onlySkills: true } }) });

test('a change that lives only in a skill that never loaded makes the cell NOT ENOUGH EVIDENCE', () => {
  const root = mk();
  try {
    const v = run(cellDir(root, 'c9', { orch: skillMeta(['beta']), aa: skillMeta(['beta']) }));
    const a = armOf(v, 0, 'orch');
    assert.equal(a.call, op.NEE);
    assert.deepEqual(a.target.neverLoaded, ['alpha']);
    assert.match(a.reasons.join(' '), /skill alpha never loaded in any run of orch/);
    const loaded = run(cellDir(root, 'c10', { orch: skillMeta(['alpha']), aa: skillMeta(['alpha']) }));
    const b = armOf(loaded, 0, 'orch');
    assert.equal(b.call, op.PASS, b.reasons.join('; '));
    assert.deepEqual(b.target.loaded, { alpha: 30 });
  } finally { rm(root); }
});

test('a mixed change only notes the skill that never loaded; --changed-skills overrides what the arm recorded', () => {
  const root = mk();
  try {
    const mixed = { extraFn: () => ({ skillsLoaded: [], changedSkills: { names: ['alpha'], onlySkills: false } }) };
    const a = armOf(run(cellDir(root, 'c11', { orch: mixed, aa: mixed })), 0, 'orch');
    assert.equal(a.call, op.PASS, a.reasons.join('; '));
    assert.match(a.notes.join(' '), /skill alpha never loaded/);
    const over = armOf(run(cellDir(root, 'c12', { orch: skillMeta(['beta']), aa: skillMeta(['beta']) }), { changedSkills: ['beta'] }), 0, 'orch');
    assert.equal(over.call, op.PASS, 'with beta named as the changed skill and loaded, the check is met');
  } finally { rm(root); }
});

test('a pure skill change with no load data cannot be checked and is NOT ENOUGH EVIDENCE', () => {
  const root = mk();
  try {
    const noData = { extraFn: () => ({ skillsLoaded: null, changedSkills: { names: ['alpha'], onlySkills: true } }) };
    const a = armOf(run(cellDir(root, 'c13', { orch: noData, aa: noData })), 0, 'orch');
    assert.equal(a.call, op.NEE);
    assert.match(a.reasons.join(' '), /no skill-load data/);
  } finally { rm(root); }
});

// ---- cells ----

test('cells are keyed by (harness, model); a GPT cell shows its cost ratio next to the Claude cell, not raw credits', () => {
  const root = mk();
  try {
    const claude = cellDir(root, 'claude', {});
    // the GPT cell costs 3x the credits everywhere but the same ratio to vanilla
    const gpt = cellDir(root, 'gpt', { model: 'gpt-5.6-sol', vanilla: { credits: 15 }, orch: { credits: 24 }, aa: { credits: 24 } });
    const v = run([claude, gpt]);
    assert.deepEqual(v.cells.map((c) => c.key).sort(), ['kiro-cli v3 / claude-sonnet-5.5', 'kiro-cli v3 / gpt-5.6-sol']);
    const g = v.cells.find((c) => c.model === 'gpt-5.6-sol');
    assert.equal(g.family, 'gpt');
    const cmp = g.ratioComparison.find((x) => x.armId === 'orch');
    assert.equal(cmp.gpt.perRun, 1.6);
    assert.equal(cmp.claude.perRun, 1.6);
    assert.equal(cmp.relativePerRun, 1);
    assert.equal(cmp.reference, 'kiro-cli v3 / claude-sonnet-5.5');
    assert.equal(armOf(v, v.cells.indexOf(g), 'orch').cost.ratioPerRun, 1.6, 'the GPT cell is judged on its own ratio');
    assert.equal(v.cells.find((c) => c.model === 'claude-sonnet-5.5').ratioComparison, undefined);
  } finally { rm(root); }
});

test('an older run whose results say kiro-cli-v2 is still a kiro-cli cell with its engine', () => {
  const root = mk();
  try {
    const meta = { model: 'claude-sonnet-5.5', harness: 'kiro-cli-v2' };
    const d = fixtureRun(root, 'old', { arms: { vanilla: { hidden: VAN, credits: 5, extra: meta }, orch: { sha: 'a', hidden: [9], credits: 8, extra: meta } }, config: { model: 'claude-sonnet-5.5', agentEngine: 'v2' } });
    assert.equal(run(d).cells[0].key, 'kiro-cli v2 / claude-sonnet-5.5');
  } finally { rm(root); }
});

test('the written page reads as sentences: a reason starts with a capital', () => {
  const root = mk();
  try {
    const d = cellDir(root, 'cap', { noAA: true });
    const out = path.join(root, 'o');
    const r = spawnSync('node', [BENCH_JS, 'report', '--run', d.dir, '--bench-dir', d.benchDir, '--verdict', 'orchestrator-pass', '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(out, 'orchestrator-pass.md'), 'utf8'), /NOT ENOUGH EVIDENCE\. There is no A\/A repeat/);
  } finally { rm(root); }
});

test('an arm at the same ref with another config is judged on its own and is not taken for the A/A repeat', () => {
  const root = mk();
  try {
    const meta = { model: CELL.model, agentEngine: 'v3', harness: 'kiro-cli' };
    const coord = { sha: 'a', hidden: [9], credits: 9, extra: { ...meta, armConfig: { orchestration: { mode: 'coordinator' } } } };
    const v = run(cellDir(root, 'cfg', { extraArms: { 'orch-coord': coord } }));
    assert.equal(armOf(v, 0, 'orch-coord').aaRepeatOf, null);
    assert.ok(armOf(v, 0, 'orch-coord').call);
    assert.equal(armOf(v, 0, 'orch-b').aaRepeatOf, armOf(v, 0, 'orch').label);
    assert.equal(armOf(v, 0, 'orch-coord').cost.ratioPerRun, 1.8);
    const { analyze } = require('../../report/generate.js');
    const { loadRun } = require('../../report/load.js');
    const { loadTasks } = require('../lib/tasks.js');
    const d = fixtureRun(root, 'cfg2', { arms: { vanilla: { hidden: VAN, credits: 5, extra: meta }, orch: { sha: 'a', hidden: [9], credits: 8, extra: meta }, 'orch-ac': coord, 'orch-b': { sha: 'a', hidden: [9], credits: 8, extra: meta } }, config: { model: CELL.model, agentEngine: 'v3', harness: 'kiro-cli' } });
    assert.deepEqual(analyze({ run: loadRun(d.dir), tasks: loadTasks(d.benchDir), baseline: 'vanilla' }).facts.aa.pair, ['orch', 'orch-b'], 'the scorecard sentinel is the repeat, not the other config');
  } finally { rm(root); }
});

test('a GPT cell with no Claude cell says so instead of comparing', () => {
  const root = mk();
  try {
    const v = run(cellDir(root, 'g1', { model: 'gpt-5.6-sol' }));
    assert.deepEqual(v.cells[0].ratioComparison, []);
    assert.match(v.notes.join(' '), /gpt-5\.6-sol has no Claude cell on the same harness to compare ratios with/);
  } finally { rm(root); }
});

test('the same cell in two run directories is pooled by exact ref', () => {
  const root = mk();
  try {
    const v = run([cellDir(root, 'p1', {}), cellDir(root, 'p2', {})]);
    assert.equal(v.cells.length, 1);
    assert.equal(armOf(v, 0, 'orch').quality.n, 60);
  } finally { rm(root); }
});

test('a directory with no vanilla runs is left out and named', () => {
  const root = mk();
  try {
    const good = cellDir(root, 'v1', {});
    const noBase = fixtureRun(root, 'v2', { arms: { orch: { sha: 'a', hidden: [9], credits: 8 } }, reps: 3, config: CELL });
    const v = run([good, noBase]);
    assert.equal(v.skippedDirs.length, 1);
    assert.match(v.skippedDirs[0].reason, /no run of the baseline arm "vanilla"/);
  } finally { rm(root); }
});

test('orchestration figures sit beside each arm', () => {
  const root = mk();
  try {
    const a = armOf(run(cellDir(root, 'o1', {})), 0, 'orch');
    assert.equal(typeof a.orch.runs, 'number');
    assert.ok('spawns' in a.orch && 'reviewRounds' in a.orch && 'reworksAfterPass' in a.orch && 'maxDepth' in a.orch);
  } finally { rm(root); }
});

// ---- the command ----

test('report --verdict orchestrator-pass writes the page and prints one line per arm and cell', () => {
  const root = mk();
  try {
    const d = cellDir(root, 'cli', {});
    const out = path.join(root, 'out');
    const r = spawnSync('node', [BENCH_JS, 'report', '--run', d.dir, '--bench-dir', d.benchDir, '--verdict', 'orchestrator-pass', '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Orchestrator pass rule against vanilla/);
    assert.match(r.stdout, /kiro-cli v3 \/ claude-sonnet-5\.5/);
    assert.match(r.stdout, /orch@aaaaaaa\s+PASS/);
    const md = fs.readFileSync(path.join(out, 'orchestrator-pass.md'), 'utf8');
    assert.match(md, /at most 2\.0x/);
    assert.match(md, /pooled within-cell standard deviation/);
    const json = JSON.parse(fs.readFileSync(path.join(out, 'orchestrator-pass.json'), 'utf8'));
    assert.equal(json.cells[0].arms.find((a) => a.armId === 'orch').call, 'PASS');
    assert.ok(fs.existsSync(path.join(out, 'orchestrator-pass.html')));
  } finally { rm(root); }
});

test('--verdict takes platform or orchestrator-pass; the new flags are accepted', () => {
  const { checkArgs } = require('../lib/cli-flags.js');
  assert.equal(checkArgs('report', { _: [], run: 'x', verdict: 'orchestrator-pass', 'test-arms': 'a', 'changed-skills': 'b', phases: 'all' }), null);
  const root = mk();
  try {
    const d = cellDir(root, 'bad', {});
    const r = spawnSync('node', [BENCH_JS, 'report', '--run', d.dir, '--bench-dir', d.benchDir, '--verdict', 'nope', '--out', path.join(root, 'o')], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--verdict takes platform or orchestrator-pass/);
  } finally { rm(root); }
});
