// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { computeScores, qualityOfRun, DEFAULT_WEIGHTS, loadScoring, FORMULAS } = require('../../report/scores.js');
const { mkScratch } = require('./scratch.js');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

let seq = 0;
function row(o = {}) {
  seq++;
  return {
    arm: 'base', task: 't1', cls: 'simple', rep: seq, outcome: 'good', status: 'success',
    hidden: null, checks: 1, rubric: null, rubricRaw: null, credits: 2, wall: 1000, modelCalls: 4, workToolCalls: 3, subagentCalls: 0,
    turns: 0, ...o,
  };
}
const many = (n, o) => Array.from({ length: n }, () => row(o));

test('quality is the weighted mean of the available components, renormalised', () => {
  const all = qualityOfRun({ hidden: 0.8, checks: 1, rubric: 0.6 }, DEFAULT_WEIGHTS);
  near(all.score, (0.5 * 0.8 + 0.2 * 1 + 0.3 * 0.6) * 100);
  assert.deepEqual(all.used, ['hidden', 'checks', 'rubric']);

  const noRubric = qualityOfRun({ hidden: 0.8, checks: 1, rubric: null }, DEFAULT_WEIGHTS);
  near(noRubric.score, ((0.5 * 0.8 + 0.2 * 1) / 0.7) * 100);
  assert.deepEqual(noRubric.used, ['hidden', 'checks']);

  const rubricOnly = qualityOfRun({ hidden: null, checks: null, rubric: 0.25 }, DEFAULT_WEIGHTS);
  near(rubricOnly.score, 25);

  assert.equal(qualityOfRun({ hidden: null, checks: null, rubric: null }, DEFAULT_WEIGHTS), null);
});

test('a zero weight drops the component; custom weights renormalise', () => {
  const r = qualityOfRun({ hidden: 1, checks: 0, rubric: 0 }, { hidden: 1, checks: 0, rubric: 0 });
  near(r.score, 100);
  assert.deepEqual(r.used, ['hidden']);
  const mix = qualityOfRun({ hidden: 1, checks: 0, rubric: null }, { hidden: 1, checks: 1, rubric: 5 });
  near(mix.score, 50);
  assert.equal(qualityOfRun({ hidden: 1, checks: null, rubric: null }, { hidden: 0, checks: 0, rubric: 0 }), null);
});

test('a failed check run scores 0 quality, not missing', () => {
  const r = qualityOfRun({ hidden: null, checks: 0, rubric: null }, DEFAULT_WEIGHTS);
  assert.equal(r.score, 0);
});

test('arm quality has n, a bootstrap CI and the components used', () => {
  const rows = [
    ...many(2, { hidden: 1, checks: 1, rubric: 0.8, rubricRaw: 0.9 }),
    ...many(2, { hidden: 0.5, checks: 0, rubric: 0.6, rubricRaw: 0.7 }),
  ];
  const s = computeScores({ rows, baseline: 'base' });
  const q = s.arms.base.overall.quality;
  assert.equal(q.n, 4);
  near(q.value, ((0.5 + 0.2 + 0.3 * 0.8) * 100 * 2 + (0.25 + 0 + 0.18) * 100 * 2) / 4);
  assert.ok(q.ciLow <= q.value && q.value <= q.ciHigh);
  assert.deepEqual(q.components.hidden.n, 4);
  assert.equal(q.components.rubric.n, 4);
  near(q.rubricRawMean, 80);
  assert.equal(q.anecdotal, false);
  assert.match(q.inputs, /hidden/);
  assert.match(q.inputs, /rubric/);
});

test('n below 3 is labelled anecdotal and the label is on every score', () => {
  const s = computeScores({ rows: [row({ checks: 1 }), row({ checks: 0, outcome: 'checksFailed' })], baseline: 'base' });
  const cell = s.arms.base.overall;
  assert.equal(cell.quality.anecdotal, true);
  assert.equal(cell.reliability.anecdotal, true);
  assert.ok(s.rows.every((r) => r.n < 3 ? r.anecdotal : true));
});

test('empty population gives null values with n 0, not NaN', () => {
  const s = computeScores({ rows: [row({ outcome: 'infraError', checks: null })], baseline: 'base' });
  const q = s.arms.base.overall.quality;
  assert.equal(q.n, 0);
  assert.equal(q.value, null);
  assert.equal(q.excluded.infraError, 1);
  assert.equal(s.arms.base.overall.reliability.value, 0);
});

test('reliability counts timeouts, errors, infra errors and model mismatches and never hides them', () => {
  const rows = [...many(5, {}), row({ outcome: 'timeout', status: 'timeout', checks: 0 }), row({ outcome: 'error', status: 'error', checks: null }), row({ outcome: 'infraError', checks: null }), row({ outcome: 'modelMismatch', checks: null })];
  const s = computeScores({ rows, baseline: 'base' });
  const rel = s.arms.base.overall.reliability;
  assert.equal(rel.n, 9);
  near(rel.value, (5 / 9) * 100);
  assert.deepEqual(rel.counts, { timeout: 1, error: 1, infraError: 1, modelMismatch: 1 });
  const q = s.arms.base.overall.quality;
  assert.equal(q.excluded.infraError, 1);
  assert.equal(q.excluded.modelMismatch, 1);
  assert.equal(q.excluded.noComponents, 1, 'the errored run with no component is listed, not scored');
  assert.equal(q.n, 6, 'the timeout with a failed check still counts, at 0');
  near(q.value, (5 * 100 + 0) / 6);
});

test('checksFailed lowers quality but not reliability', () => {
  const rows = [...many(3, {}), row({ outcome: 'checksFailed', checks: 0 })];
  const s = computeScores({ rows, baseline: 'base' });
  near(s.arms.base.overall.reliability.value, 100);
  near(s.arms.base.overall.quality.value, 75);
});

test('quality at ceiling is flagged', () => {
  const s = computeScores({ rows: many(4, { hidden: 1, checks: 1 }), baseline: 'base' });
  assert.equal(s.arms.base.overall.quality.ceiling, true);
  const low = computeScores({ rows: many(4, { hidden: 0.5, checks: 1 }), baseline: 'base' });
  assert.equal(low.arms.base.overall.quality.ceiling, false);
});

test('per task class scopes are computed separately', () => {
  const rows = [...many(3, { cls: 'simple', checks: 1 }), ...many(3, { cls: 'review', checks: 0, outcome: 'checksFailed' })];
  const s = computeScores({ rows, baseline: 'base' });
  assert.deepEqual(s.scopes, ['overall', 'simple', 'review']);
  near(s.arms.base.simple.quality.value, 100);
  near(s.arms.base.review.quality.value, 0);
  near(s.arms.base.overall.quality.value, 50);
});

test('autonomy is the completed-without-help share, with interjections and unnecessary questions beside it', () => {
  const a = (o) => row({ turns: 1, interjections: 0, questionsAsked: 0, completedWithoutHelp: true, noQuestionTask: false, ...o });
  const rows = [a({}), a({}), a({ completedWithoutHelp: false, interjections: 2, questionsAsked: 2 }), a({ noQuestionTask: true, questionsAsked: 1, completedWithoutHelp: false, interjections: 1 }), a({ noQuestionTask: true })];
  const s = computeScores({ rows, baseline: 'base' });
  const au = s.arms.base.overall.autonomy;
  assert.equal(au.n, 5);
  near(au.value, 60);
  near(au.interjectionsPerTask, 0.6);
  near(au.unnecessaryQuestionRate, 0.5);
  assert.equal(au.unnecessaryQuestionN, 2);
  const none = computeScores({ rows: many(3, {}), baseline: 'base' });
  assert.equal(none.arms.base.overall.autonomy, null);
});

test('efficiency is a ratio to the base arm, not a 0..100 number', () => {
  const rows = [...many(4, { arm: 'base', credits: 2 }), ...many(4, { arm: 'head', credits: 4, wall: 3000, modelCalls: 8 })];
  const s = computeScores({ rows, baseline: 'base' });
  const e = s.arms.head.overall.efficiency;
  near(e.creditsPerSuccess.value, 4);
  near(e.creditsPerSuccess.ratio, 2);
  assert.ok(e.creditsPerSuccess.ciLow <= 2 && e.creditsPerSuccess.ciHigh >= 2);
  near(e.wall.ratio, 3);
  near(e.modelCalls.ratio, 2);
  near(s.arms.base.overall.efficiency.creditsPerSuccess.ratio, 1);
});

test('credits per success counts failures in the numerator', () => {
  const rows = [...many(2, { arm: 'base', credits: 2 }), ...many(2, { arm: 'head', credits: 2 }), row({ arm: 'head', credits: 6, outcome: 'timeout', status: 'timeout', checks: 0 })];
  const s = computeScores({ rows, baseline: 'base' });
  near(s.arms.head.overall.efficiency.creditsPerSuccess.value, 10 / 2);
});

test('credits per quality point states the ceiling caveat', () => {
  const rows = [...many(4, { arm: 'base', credits: 2, hidden: 1, checks: 1 }), ...many(4, { arm: 'head', credits: 4, hidden: 0.6, checks: 1 })];
  const s = computeScores({ rows, baseline: 'base' });
  const b = s.arms.base.overall.efficiency.creditsPerQualityPoint;
  near(b.value, 2 / 100);
  assert.match(b.caveat, /ceiling/);
  const h = s.arms.head.overall.efficiency.creditsPerQualityPoint;
  near(h.value, 4 / (((0.5 * 0.6 + 0.2) / 0.7) * 100));
  assert.match(h.caveat, /base arm is at ceiling/);
});

test('efficiency is null, not NaN, when no run passed cleanly', () => {
  const s = computeScores({ rows: [row({ outcome: 'timeout', status: 'timeout', checks: 0 })], baseline: 'base' });
  assert.equal(s.arms.base.overall.efficiency.creditsPerSuccess.value, null);
  assert.equal(s.arms.base.overall.efficiency.creditsPerQualityPoint.value, null);
  assert.ok(!JSON.stringify(s).includes('NaN') && !JSON.stringify(s).includes('Infinity'));
});

test('score rows list inputs and n for every number', () => {
  const s = computeScores({ rows: [...many(3, { hidden: 1, checks: 1 }), ...many(3, { arm: 'head', hidden: 0.5 })], baseline: 'base' });
  assert.ok(s.rows.length >= 6);
  for (const r of s.rows) {
    assert.equal(typeof r.n, 'number');
    assert.ok(r.inputs && r.name && r.arm && r.scope);
  }
});

test('the scoring profile loads, validates and defaults to 0.5, 0.2, 0.3', () => {
  assert.deepEqual(DEFAULT_WEIGHTS, { hidden: 0.5, checks: 0.2, rubric: 0.3 });
  const real = loadScoring();
  assert.deepEqual(real, DEFAULT_WEIGHTS);
  const dir = mkScratch('scoretest-');
  const f = path.join(dir, 's.json');
  fs.writeFileSync(f, JSON.stringify({ weights: { hidden: 1, checks: 0, rubric: 0 } }));
  assert.deepEqual(loadScoring(f), { hidden: 1, checks: 0, rubric: 0 });
  fs.writeFileSync(f, JSON.stringify({ weights: { hidden: -1, checks: 0, rubric: 0 } }));
  assert.throws(() => loadScoring(f), /weight/);
  fs.writeFileSync(f, JSON.stringify({ weights: { hidden: 1, bogus: 1 } }));
  assert.throws(() => loadScoring(f), /unknown/);
  fs.writeFileSync(f, JSON.stringify({ weights: { hidden: 0, checks: 0, rubric: 0 } }));
  assert.throws(() => loadScoring(f), /at least one/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('formulas are documented in code', () => {
  for (const k of ['quality', 'reliability', 'autonomy', 'efficiency', 'capability']) assert.ok(FORMULAS[k] && FORMULAS[k].length > 20, k);
});
