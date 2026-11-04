// SPDX-License-Identifier: Apache-2.0
'use strict';

// The platform verdict: keep, discard or not enough evidence for each arm against the baseline. The hard rules:
// n under 3, a result inside the A/A noise, or an anecdotal diligence rating can only ever give NOT ENOUGH EVIDENCE.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixtureRun, mk, SHA, TASKS6 } = require('./verdict-fixtures.js');
const { writeJudgments } = require('./helpers.js');
const V = require('../../report/verdict.js');

const KEEP = 'KEEP';
const DISCARD = 'DISCARD';
const NEE = 'NOT ENOUGH EVIDENCE';
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });
const verdictFor = (v, label) => v.arms.find((a) => a.label === label);

// vanilla 8/10, the konductor arm 9/10 twice (the arm and its A/A repeat): +7.1 points, A/A spread 0
const ARMS = (over = {}) => ({
  vanilla: { hidden: [4], credits: 1 },
  a: { sha: 'a', hidden: [9], credits: 2 },
  'a-b': { sha: 'a', hidden: [9], credits: 2 },
  ...over,
});

// ---- the pure decision ----

const base = () => ({
  cells: 6, pairedCells: 6, nHead: 30, nBase: 30, minReps: 5, rating: 'indicative', ratingBy: [],
  noise: { available: true, pts: 5 }, quality: { delta: 20, ciLow: 12, ciHigh: 28 }, reliability: { delta: 0, ciLow: -5, ciHigh: 5 },
  nonScored: { head: { n: 0, total: 30 }, base: { n: 0, total: 30 } }, components: { ok: true }, cost: { ratio: 1.2 },
});

test('decide: a clear gain outside the noise with enough runs is KEEP; a clear loss is DISCARD', () => {
  assert.equal(V.decide(base()).verdict, KEEP);
  assert.equal(V.decide({ ...base(), quality: { delta: -20, ciLow: -28, ciHigh: -12 } }).verdict, DISCARD);
});

test('decide: n under 3 on either side is always NOT ENOUGH EVIDENCE', () => {
  for (const [nHead, nBase] of [[2, 10], [10, 2], [0, 10], [1, 1]]) {
    const d = V.decide({ ...base(), nHead, nBase });
    assert.equal(d.verdict, NEE, `${nHead}/${nBase}`);
    assert.match(d.reason, /fewer than 3 runs/);
  }
});

test('decide: a difference inside the A/A noise is always NOT ENOUGH EVIDENCE, however large the sample', () => {
  const d = V.decide({ ...base(), nHead: 500, nBase: 500, quality: { delta: 4, ciLow: 1, ciHigh: 7 } });
  assert.equal(d.verdict, NEE);
  assert.match(d.reason, /inside the A\/A noise of 5\.0 points/);
  assert.equal(V.decide({ ...base(), quality: { delta: -5, ciLow: -9, ciHigh: -1 } }).verdict, NEE, 'exactly at the noise is inside it');
});

test('decide: an anecdotal diligence rating is always NOT ENOUGH EVIDENCE and the reason names it', () => {
  const d = V.decide({ ...base(), rating: 'anecdotal', ratingBy: [{ dir: '/r', rating: 'anecdotal', blockers: ['Judge families and Claude exclusion (FAIL)'] }] });
  assert.equal(d.verdict, NEE);
  assert.match(d.reason, /diligence rating is anecdotal/);
});

test('decide: no A/A noise floor, under 3 replicates in a cell, no shared cells and a CI that includes 0 are each NOT ENOUGH EVIDENCE', () => {
  assert.match(V.decide({ ...base(), noise: { available: false, pts: null } }).reason, /no A\/A noise floor/);
  assert.match(V.decide({ ...base(), minReps: 2 }).reason, /fewer than 3 replicates in a cell/);
  assert.match(V.decide({ ...base(), cells: 0 }).reason, /no run of the baseline on the same tasks/);
  assert.match(V.decide({ ...base(), quality: { delta: 12, ciLow: -3, ciHigh: 27 } }).reason, /interval .* includes 0/);
  assert.match(V.decide({ ...base(), pairedCells: 4 }).reason, /fewer than 5 paired task cells \(4\)/);
});

test('decide: a quality gain with clearly lower reliability is not a KEEP', () => {
  const d = V.decide({ ...base(), reliability: { delta: -20, ciLow: -30, ciHigh: -10 } });
  assert.equal(d.verdict, NEE);
  assert.match(d.reason, /quality is up .* reliability is clearly down/);
});

test('decide: no parameter combination that breaks a hard rule can give KEEP or DISCARD', () => {
  const grids = {
    nHead: [0, 2, 3, 40], nBase: [0, 2, 3, 40], rating: ['anecdotal', 'indicative', 'supported'], minReps: [1, 2, 5], pairedCells: [3, 4, 5, 8],
    noise: [{ available: false, pts: null }, { available: true, pts: 5 }, { available: true, pts: 60 }],
    quality: [{ delta: 30, ciLow: 20, ciHigh: 40 }, { delta: -30, ciLow: -40, ciHigh: -20 }, { delta: 3, ciLow: 1, ciHigh: 5 }, { delta: 30, ciLow: -2, ciHigh: 60 }],
  };
  let decided = 0;
  for (const nHead of grids.nHead) for (const nBase of grids.nBase) for (const rating of grids.rating) for (const minReps of grids.minReps) for (const pairedCells of grids.pairedCells) for (const noise of grids.noise) for (const quality of grids.quality) {
    const d = V.decide({ ...base(), nHead, nBase, rating, minReps, pairedCells, noise, quality });
    const broken = nHead < 3 || nBase < 3 || rating === 'anecdotal' || minReps < 3 || pairedCells < 5 || !noise.available || Math.abs(quality.delta) <= noise.pts;
    if (broken) assert.equal(d.verdict, NEE, JSON.stringify({ nHead, nBase, rating, pairedCells, minReps, noise, quality }));
    else decided += d.verdict === NEE ? 0 : 1;
  }
  assert.ok(decided > 0, 'the grid also contains cases that are allowed to be decided');
});

test('decide: every reason that applies is listed, not only the first', () => {
  const d = V.decide({ ...base(), nHead: 2, rating: 'anecdotal', noise: { available: false, pts: null } });
  assert.match(d.reason, /fewer than 3 runs/);
  assert.match(d.reason, /anecdotal/);
  assert.match(d.reason, /no A\/A noise floor/);
});

// ---- labels ----

test('refLabel names an arm by its exact ref: id@sha7 for a commit, id@dir:hash for a directory, vanilla alone', () => {
  assert.equal(V.refLabel({ armId: 'main', commitSha: SHA.a }), 'main@aaaaaaa');
  assert.equal(V.refLabel({ armId: 'v1.2.0', commitSha: SHA.b }), 'v1.2.0@bbbbbbb');
  assert.equal(V.refLabel({ armId: 'pr-1', commitSha: null, contentHash: 'f'.repeat(40) }), 'pr-1@dir:ffffffffffff');
  assert.equal(V.refLabel({ armId: 'vanilla', commitSha: null, contentHash: null }), 'vanilla');
});

// ---- from run directories ----

test('KEEP: a gain well outside the A/A noise, 30 runs a side, six tasks, five replicates a task', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS(), tasks: TASKS6 });
    const v = V.buildVerdict({ dirs: [dir], benchDir });
    const a = verdictFor(v, 'a@aaaaaaa');
    assert.equal(a.verdict, KEEP, a.reason);
    assert.equal(a.quality.n, 30);
    assert.equal(a.quality.baseN, 30);
    assert.equal(a.quality.k, 6);
    assert.ok(Math.abs(a.quality.delta - 5 * (100 / 14)) < 0.01, String(a.quality.delta));
    assert.equal(a.noise.available, true);
    assert.ok(a.noise.pts >= 5);
    assert.equal(a.minReps, 5);
    assert.match(a.sentence, /^Keep\. a@aaaaaaa scored 35\.7 points higher than vanilla/);
    const ci = a.sentence.match(/paired 95% interval of the difference (-?[\d.]+) to (-?[\d.]+)/);
    assert.ok(ci, a.sentence);
    assert.ok(Number(ci[1]) <= a.quality.delta + 0.05 && a.quality.delta - 0.05 <= Number(ci[2]), 'the interval in the sentence is the interval of the difference');
    assert.equal(v.baselineLabel, 'vanilla');
    assert.equal(verdictFor(v, 'a-b@aaaaaaa').aaRepeatOf, 'a@aaaaaaa');
  } finally { cleanup(root); }
});

test('DISCARD: the arm is clearly worse than vanilla', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS({ vanilla: { hidden: [9] }, a: { sha: 'a', hidden: [3] }, 'a-b': { sha: 'a', hidden: [3] } }), tasks: TASKS6 });
    const a = verdictFor(V.buildVerdict({ dirs: [dir], benchDir }), 'a@aaaaaaa');
    assert.equal(a.verdict, DISCARD, a.reason);
    assert.match(a.sentence, /^Discard\./);
  } finally { cleanup(root); }
});

test('NOT ENOUGH EVIDENCE when n is under 3, and the reason says so', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS(), reps: 2, tasks: ['t1'] });
    const a = verdictFor(V.buildVerdict({ dirs: [dir], benchDir }), 'a@aaaaaaa');
    assert.equal(a.verdict, NEE);
    assert.match(a.reason, /fewer than 3 runs/);
  } finally { cleanup(root); }
});

test('NOT ENOUGH EVIDENCE when the difference is inside the A/A noise, whatever the sample size', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS({ vanilla: { hidden: [8] }, a: { sha: 'a', hidden: [9] }, 'a-b': { sha: 'a', hidden: [5] } }), reps: 8 });
    const a = verdictFor(V.buildVerdict({ dirs: [dir], benchDir }), 'a@aaaaaaa');
    assert.equal(a.verdict, NEE, a.reason);
    assert.match(a.reason, /inside the A\/A noise/);
    assert.ok(a.noise.pts > 20);
  } finally { cleanup(root); }
});

test('NOT ENOUGH EVIDENCE when there is no A/A arm at all', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: { vanilla: { hidden: [4] }, a: { sha: 'a', hidden: [9] } } });
    const a = verdictFor(V.buildVerdict({ dirs: [dir], benchDir }), 'a@aaaaaaa');
    assert.equal(a.verdict, NEE);
    assert.match(a.reason, /no A\/A noise floor/);
  } finally { cleanup(root); }
});

test('NOT ENOUGH EVIDENCE when the diligence rating is anecdotal (here a Claude judge), and the rating is shown', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS() });
    writeJudgments(dir, { judges: ['claude-sonnet-4.6'], rubric: [], pairwise: [] });
    const a = verdictFor(V.buildVerdict({ dirs: [dir], benchDir }), 'a@aaaaaaa');
    assert.equal(a.diligence.rating, 'anecdotal');
    assert.equal(a.verdict, NEE);
    assert.match(a.reason, /diligence rating is anecdotal/);
  } finally { cleanup(root); }
});

test('failed runs are never dropped: they lower reliability, count as 0 quality and are listed', () => {
  const root = mk();
  try {
    const arms = ARMS({ a: { sha: 'a', hidden: [9], failNoScore: true, fail: (k) => (k % 5 === 0 ? 'timeout' : null) } });
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms });
    const a = verdictFor(V.buildVerdict({ dirs: [dir], benchDir }), 'a@aaaaaaa');
    assert.equal(a.failures.timeout, 2);
    assert.equal(a.runs, 10);
    assert.equal(a.quality.n, 10, 'the two timeouts are in the quality mean, as zeros');
    assert.equal(a.failedAsZero, 2);
    assert.ok(a.reliability.value < 85 && a.reliability.value > 75, String(a.reliability.value));
    assert.ok(a.quality.value < 92 - 15, `zeros pull quality down: ${a.quality.value}`);
  } finally { cleanup(root); }
});

test('the same arm id at two commits is two arms, labelled by exact ref, never merged', () => {
  const root = mk();
  try {
    const one = fixtureRun(root, 'lite', { arms: { vanilla: { hidden: [4] }, main: { sha: 'a', hidden: [9] }, 'main-b': { sha: 'a', hidden: [9] } } });
    const two = fixtureRun(root, 'real', { bench: one.benchDir, arms: { vanilla: { hidden: [4] }, main: { sha: 'b', hidden: [9] }, 'main-b': { sha: 'b', hidden: [9] } } });
    const v = V.buildVerdict({ dirs: [one.dir, two.dir], benchDir: one.benchDir });
    const labels = v.arms.map((a) => a.label);
    assert.ok(labels.includes('main@aaaaaaa') && labels.includes('main@bbbbbbb'), labels.join(', '));
    assert.equal(verdictFor(v, 'main@aaaaaaa').runs, 10);
    assert.equal(verdictFor(v, 'main@bbbbbbb').runs, 10);
    assert.ok(v.notes.some((n) => /main appears at 2 commits: main@aaaaaaa, main@bbbbbbb/.test(n)), v.notes.join('\n'));
  } finally { cleanup(root); }
});

test('one arm in several run directories is pooled, and the baseline is compared on the same tasks only', () => {
  const root = mk();
  try {
    const lite = fixtureRun(root, 'lite', { arms: ARMS(), tasks: ['t1'] });
    const real = fixtureRun(root, 'real', { bench: lite.benchDir, arms: ARMS(), tasks: ['t1', 't2'] });
    const v = V.buildVerdict({ dirs: [lite.dir, real.dir], benchDir: lite.benchDir });
    const a = verdictFor(v, 'a@aaaaaaa');
    assert.equal(a.runs, 15);
    assert.equal(a.baseRuns, 15);
    assert.equal(a.cells, 3);
    assert.equal(a.dirs.length, 2);
  } finally { cleanup(root); }
});

test('efficiency is a cost ratio and latency a ratio, never a 0 to 100 score', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS({ vanilla: { hidden: [4], credits: 1, wall: 1000 }, a: { sha: 'a', hidden: [9], credits: 3, wall: 2000 }, 'a-b': { sha: 'a', hidden: [9], credits: 3, wall: 2000 } }) });
    const a = verdictFor(V.buildVerdict({ dirs: [dir], benchDir }), 'a@aaaaaaa');
    assert.equal(a.cost.ratio, 3);
    assert.equal(a.cost.unit, 'credits');
    assert.equal(a.latency.ratio, 2);
    assert.ok(!('value100' in a.cost));
  } finally { cleanup(root); }
});

test('a directory with no baseline arm is listed and skipped; no baseline anywhere is an error', () => {
  const root = mk();
  try {
    const ok = fixtureRun(root, 'ok', { arms: ARMS() });
    const nov = fixtureRun(root, 'novan', { bench: ok.benchDir, arms: { a: { sha: 'a', hidden: [9] }, 'a-b': { sha: 'a', hidden: [9] } } });
    const v = V.buildVerdict({ dirs: [ok.dir, nov.dir], benchDir: ok.benchDir });
    assert.equal(v.skippedDirs.length, 1);
    assert.match(v.skippedDirs[0].reason, /no run of the baseline arm "vanilla"/);
    assert.throws(() => V.buildVerdict({ dirs: [nov.dir], benchDir: nov.benchDir }), /no run directory has the baseline arm "vanilla"/);
  } finally { cleanup(root); }
});

test('graded judging and a controls check are carried into the verdict when present', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS() });
    const rec = (o) => ({ kind: 'graded', judge: 'j1', armId: 'a', taskId: 't1', replicate: 1, baselineId: 'vanilla', armGrade: 4, baseGrade: 2, delta: 2, orderDisagreement: false, shift: 0, judgeError: null, ...o });
    fs.writeFileSync(path.join(dir, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'vanilla', judges: ['j1'], modes: ['graded'], rubric: [], pairwise: [], graded: [rec({}), rec({ replicate: 2, orderDisagreement: true })] }));
    fs.writeFileSync(path.join(dir, 'controls-check.json'), JSON.stringify({ trusted: true, summary: 'The planted lift was found and the decoy showed no effect, so the skill verdicts from this study can be trusted.' }));
    const v = V.buildVerdict({ dirs: [dir], benchDir });
    const a = verdictFor(v, 'a@aaaaaaa');
    assert.equal(a.graded.n, 2);
    assert.equal(a.graded.orderDisagreements, 1);
    assert.equal(v.dirs[0].controls.trusted, true);
  } finally { cleanup(root); }
});

test('the anecdotal reason lists the criteria that FAIL, not every warning', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS(), reps: 1 });
    const a = verdictFor(V.buildVerdict({ dirs: [dir], benchDir }), 'a@aaaaaaa');
    assert.equal(a.diligence.rating, 'anecdotal');
    assert.match(a.reason, /diligence rating is anecdotal \(Replicates per cell \(FAIL\)\)/);
    assert.ok(a.diligence.byDir[0].blockers.length > a.diligence.byDir[0].failed.length, 'the full list of non-PASS key criteria is kept in the data');
  } finally { cleanup(root); }
});
