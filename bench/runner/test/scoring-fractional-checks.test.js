// SPDX-License-Identifier: Apache-2.0
'use strict';

// The checks term of the quality score is 1 only when every check passed, unless the scoring file says "checks": "fraction",
// in which case it is passed / total. Default weights, rows and report text must not change.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun, writeJudgments } = require('./helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const { loadRun } = require('../../report/load.js');
const { generateRunReport } = require('../../report/generate.js');
const { buildRows } = require('../../report/rows.js');
const { loadScoring, qualityOfRun, checksScore, checksModeNote, formulasForWeights, computeScores, FORMULAS } = require('../../report/scores.js');
const { mkScratch } = require('./scratch.js');

const PROFILES = path.join(__dirname, '..', '..', 'profiles');
const FRACTIONAL = path.join(PROFILES, 'scoring-fractional.json');
const QUALITY_FRACTIONAL = path.join(PROFILES, 'scoring-quality-fractional.json');
const DEFAULT = path.join(PROFILES, 'scoring.json');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const checksOf = (passed, total) => Array.from({ length: total }, (_, i) => ({ type: 'file_exists', path: 'a.txt', passed: i < passed }));
const scratchFile = (obj) => { const f = path.join(mkScratch('scoring-'), 'scoring.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

// ---- loading ----

test('default weights carry no checks mode and the shipped default file is unchanged', () => {
  assert.deepEqual(loadScoring(), { hidden: 0.5, checks: 0.2, rubric: 0.3 });
  assert.deepEqual(JSON.parse(fs.readFileSync(DEFAULT, 'utf8')).weights, { hidden: 0.5, checks: 0.2, rubric: 0.3 });
  assert.equal('checks' in JSON.parse(fs.readFileSync(DEFAULT, 'utf8')), false);
});

test('the fractional profiles keep the weights of their base file and add the mode', () => {
  assert.deepEqual(loadScoring(FRACTIONAL), { hidden: 0.5, checks: 0.2, rubric: 0.3, checksMode: 'fraction' });
  assert.deepEqual(loadScoring(QUALITY_FRACTIONAL, { allowPack: true }), { hidden: 0.4, checks: 0.16, rubric: 0.24, pack: 0.2, checksMode: 'fraction' });
  assert.throws(() => loadScoring(QUALITY_FRACTIONAL), /pack needs the quality-pack scores/);
});

test('an explicit "all" is the default mode, and an unknown mode is refused', () => {
  assert.deepEqual(loadScoring(scratchFile({ weights: { hidden: 1, checks: 1, rubric: 1 }, checks: 'all' })), { hidden: 1, checks: 1, rubric: 1 });
  assert.throws(() => loadScoring(scratchFile({ weights: { hidden: 1, checks: 1, rubric: 1 }, checks: 'half' })), /"checks" must be one of "all", "fraction"/);
});

// ---- the checks term ----

test('checksScore: all-or-nothing by default, passed / total in fraction mode, null without checks', () => {
  const frac = { checksMode: 'fraction' };
  assert.equal(checksScore(checksOf(5, 5)), 1);
  assert.equal(checksScore(checksOf(4, 5)), 0);
  assert.equal(checksScore(checksOf(0, 5)), 0);
  assert.equal(checksScore(checksOf(5, 5), frac), 1);
  assert.equal(checksScore(checksOf(4, 5), frac), 0.8);
  assert.equal(checksScore(checksOf(0, 5), frac), 0);
  assert.equal(checksScore([], frac), null);
  assert.equal(checksScore(undefined, frac), null);
  assert.equal(checksScore([], undefined), null);
});

// ---- the formula, with and without hidden tests ----

test('without hidden tests one failed check of five costs 40 points by default and 8 in fraction mode', () => {
  const def = loadScoring();
  const frac = loadScoring(FRACTIONAL);
  const rubric = 0.6;
  const miss = { hidden: null, rubric };
  // weights renormalise to checks 0.4 / rubric 0.6
  near(qualityOfRun({ ...miss, checks: checksScore(checksOf(5, 5), def) }, def).score, (0.4 * 1 + 0.6 * rubric) * 100);
  near(qualityOfRun({ ...miss, checks: checksScore(checksOf(4, 5), def) }, def).score, (0.4 * 0 + 0.6 * rubric) * 100);
  near(qualityOfRun({ ...miss, checks: checksScore(checksOf(4, 5), frac) }, frac).score, (0.4 * 0.8 + 0.6 * rubric) * 100);
  near(qualityOfRun({ ...miss, checks: checksScore(checksOf(5, 5), frac) }, frac).score, (0.4 * 1 + 0.6 * rubric) * 100);
});

test('with hidden tests the checks term keeps its 0.2 weight in both modes', () => {
  const def = loadScoring();
  const frac = loadScoring(FRACTIONAL);
  const parts = { hidden: 0.5, rubric: 0.6 };
  near(qualityOfRun({ ...parts, checks: checksScore(checksOf(3, 4), def) }, def).score, (0.5 * 0.5 + 0.2 * 0 + 0.3 * 0.6) * 100);
  near(qualityOfRun({ ...parts, checks: checksScore(checksOf(3, 4), frac) }, frac).score, (0.5 * 0.5 + 0.2 * 0.75 + 0.3 * 0.6) * 100);
});

test('a run with every check passed scores the same in both modes', () => {
  const def = loadScoring();
  const frac = loadScoring(FRACTIONAL);
  const parts = (w) => ({ hidden: 0.9, rubric: 0.7, checks: checksScore(checksOf(6, 6), w) });
  near(qualityOfRun(parts(def), def).score, qualityOfRun(parts(frac), frac).score);
});

// ---- rows ----

function fakeCtx(scoring) {
  return {
    rubricIdx: new Map(), judges: [], rawScoreOf: () => null, classOf: () => 'simple', noQuestionTasks: new Set(),
    basis: { charged: () => 1, observed: () => 1, censored: () => false },
    ...(scoring ? { scoring } : {}),
  };
}
const fakeRun = (checks) => ({ runs: [{ armId: 'a', taskId: 't', replicate: 1, result: { status: 'success', checks, hiddenTests: null } }] });

test('buildRows reads the mode from the ctx and leaves a ctx without it as before', () => {
  const run = fakeRun(checksOf(3, 4));
  assert.equal(buildRows(run, new Map(), fakeCtx())[0].checks, 0);
  assert.equal(buildRows(run, new Map(), fakeCtx(loadScoring()))[0].checks, 0);
  assert.equal(buildRows(run, new Map(), fakeCtx(loadScoring(FRACTIONAL)))[0].checks, 0.75);
});

test('the default ctx and an explicit default scoring give identical rows', () => {
  const run = fakeRun(checksOf(3, 4));
  assert.deepEqual(buildRows(run, new Map(), fakeCtx()), buildRows(run, new Map(), fakeCtx(loadScoring())));
  assert.deepEqual(Object.keys(buildRows(run, new Map(), fakeCtx())[0]), Object.keys(buildRows(run, new Map(), fakeCtx(loadScoring(FRACTIONAL)))[0]));
});

// ---- text ----

test('the mode note and the formula wording change only in fraction mode', () => {
  assert.equal(checksModeNote(loadScoring()), '');
  assert.equal(checksModeNote(loadScoring(FRACTIONAL)), ' (scored as passed / total)');
  assert.equal(formulasForWeights(FORMULAS, loadScoring()), FORMULAS);
  const f = formulasForWeights(FORMULAS, loadScoring(FRACTIONAL));
  assert.match(f.quality, /checks \(passed \/ total, because the scoring file sets "checks": "fraction"\)/);
  assert.doesNotMatch(f.quality, /1 when every check passed/);
  assert.equal(f.reliability, FORMULAS.reliability);
  assert.match(computeScores({ rows: [], baseline: 'a', weights: loadScoring(FRACTIONAL) }).formulas.quality, /passed \/ total/);
  assert.match(computeScores({ rows: [], baseline: 'a' }).formulas.quality, /1 when every check passed/);
});

// ---- the report ----

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const P = (passed) => ({ type: 'file_exists', path: 'a.txt', passed });
  const mixes = { vanilla: [[1, 1, 1], [1, 0, 1], [0, 0, 1]], other: [[1, 1], [1, 1, 0, 0], [1, 1, 1, 1]] };
  const specs = Object.entries(mixes).flatMap(([arm, reps]) => reps.map((m, i) => ({ arm, rep: i + 1, credits: 2 + i, checks: m.map((x) => P(Boolean(x))) })));
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  const rubric = [];
  for (const arm of Object.keys(mixes)) for (let rep = 1; rep <= 3; rep++) for (const judge of ['j1', 'j2']) rubric.push({ judge, arm, rep, score: 0.5 });
  writeJudgments(runDir, { judges: ['j1', 'j2'], rubric });
  return { root, bench, runDir };
}
const report = (s, out, extra = {}) => {
  generateRunReport({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), baseline: 'vanilla', out, detail: 'full', format: 'both', defaultDir: s.runDir, ...extra });
  return { json: JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8')), md: fs.readFileSync(path.join(out, 'report.md'), 'utf8') };
};

test('a report with the fractional file scores checks as passed / total and says so; the default report does neither', () => {
  const s = setup();
  try {
    const plain = report(s, path.join(s.root, 'plain'));
    const explicit = report(s, path.join(s.root, 'explicit'), { scoringFile: DEFAULT });
    const frac = report(s, path.join(s.root, 'frac'), { scoringFile: FRACTIONAL });
    assert.deepEqual(plain.json.scores.weights, { hidden: 0.5, checks: 0.2, rubric: 0.3 });
    assert.deepEqual(explicit.json, plain.json);
    assert.equal(explicit.md, plain.md);
    assert.match(plain.md, /Weights in use: hidden 0\.5, checks 0\.2, rubric 0\.3\./);
    assert.match(plain.md, /checks \(1 when every check passed, else 0\)/);
    assert.deepEqual(frac.json.scores.weights, { hidden: 0.5, checks: 0.2, rubric: 0.3, checksMode: 'fraction' });
    assert.match(frac.md, /Weights in use: hidden 0\.5, checks 0\.2 \(scored as passed \/ total\), rubric 0\.3\./);
    assert.match(frac.md, /checks \(passed \/ total, because the scoring file sets "checks": "fraction"\)/);
    const q = (r, arm) => r.json.scores.arms[arm].overall.quality.value;
    // No hidden tests and a rubric of 0.5, so a run is (0.2 * checks + 0.15) / 0.5 * 100.
    near(q(plain, 'vanilla'), (70 + 30 + 30) / 3);
    near(q(frac, 'vanilla'), (70 + (0.2 * (2 / 3) + 0.15) / 0.5 * 100 + (0.2 * (1 / 3) + 0.15) / 0.5 * 100) / 3);
    near(q(plain, 'other'), (70 + 30 + 70) / 3);
    near(q(frac, 'other'), (70 + 50 + 70) / 3);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});
