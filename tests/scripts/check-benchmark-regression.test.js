// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for tests/scripts/check-benchmark-regression.js.
 *
 * The key case this file must prove: the regression gate is NOT vacuous
 * for scenario subsets that declare no required tools (every scenario in
 * tests/asdlc-developer/developer-scenarios.json and
 * tests/asdlc-quality-assurance/qa-scenarios.json). A toolUse-only gate
 * would have `toolScore` be a constant 2 for such scenarios, so the
 * bootstrap CI would collapse to [0, 0] and could never flag a
 * regression: see `toolUse score is a constant, gate can never fire`
 * below, which pins that failure mode, and `success-rate gate fires when
 * success drops` which proves the real gate actually can fire in exactly
 * that scenario shape.
 *
 * Run: node --test tests/scripts/check-benchmark-regression.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const regression = require('./check-benchmark-regression.js');

/** Builds a minimal result entry with N attempts, all reporting the same
 * `success` value and the same constant `toolUse.score` -- mirrors the
 * shape scripts/run-claude-subset.js writes for a scenario whose
 * `expectedTools.required` is empty (toolScore is always 2 in that case). */
function makeResult(taskId, { successes, toolUseScore = 2 }) {
  return {
    taskId,
    success: successes.every(Boolean),
    attempts: successes.map((success) => ({
      success,
      metrics: { scores: { toolUse: { score: toolUseScore } } },
    })),
  };
}

function makeRun(results, model = 'claude-sonnet-5') {
  return { metadata: { model }, results };
}

test('successRates extracts 1/0 per attempt and ignores non-boolean success', () => {
  const result = {
    attempts: [{ success: true }, { success: false }, { success: 'not-a-bool' }, {}],
  };
  assert.deepEqual(regression.successRates(result), [1, 0]);
});

test('toolUseScores extracts numeric scores and ignores malformed attempts', () => {
  const result = {
    attempts: [
      { metrics: { scores: { toolUse: { score: 2 } } } },
      { metrics: { scores: { toolUse: { score: 'bad' } } } },
      {},
    ],
  };
  assert.deepEqual(regression.toolUseScores(result), [2]);
});

test('deltaCI skips gating (unbounded CI) when either side has < 2 replicates', () => {
  const ci = regression.deltaCI([1], [1, 0]);
  assert.equal(ci.ciLow, -Infinity);
  assert.equal(ci.ciHigh, Infinity);
});

test('deltaCI computes a bounded CI when both sides have >= 2 replicates', () => {
  const ci = regression.deltaCI([1, 1], [0, 0]);
  assert.ok(Number.isFinite(ci.ciLow));
  assert.ok(Number.isFinite(ci.ciHigh));
  assert.equal(ci.mean, 1);
});

test('non-vacuousness: toolUse score is a constant for no-required-tools scenarios, so the OLD gate could never fire', () => {
  // This pins the bug: even though the baseline and new run's success rates
  // are wildly different, the toolUse-score series alone is constant on
  // both sides, so a toolUse-only CI is degenerate ([0, 0]) and can never
  // report a regression.
  const baseline = makeResult('developer-workspace-skills', { successes: [true, true], toolUseScore: 2 });
  const newRun = makeResult('developer-workspace-skills', { successes: [false, false], toolUseScore: 2 });

  const toolCi = regression.deltaCI(regression.toolUseScores(newRun), regression.toolUseScores(baseline));
  assert.equal(toolCi.mean, 0);
  assert.ok(!(toolCi.ciHigh < 0), 'toolUse-only CI must not flag a regression here (this is the bug being fixed)');
});

test('non-vacuousness: the success-rate gate CAN fire when success drops, even though toolUse is unchanged', () => {
  const baseline = makeResult('developer-workspace-skills', { successes: [true, true], toolUseScore: 2 });
  const newRun = makeResult('developer-workspace-skills', { successes: [false, false], toolUseScore: 2 });

  const result = regression.compareRuns(makeRun([newRun]), makeRun([baseline]));

  assert.equal(result.modelMismatch, null);
  assert.equal(result.regressions.length, 1, 'expected the success-rate gate to fire');
  assert.match(result.regressions[0], /developer-workspace-skills/);
  assert.equal(result.okLines.length, 0);
});

test('main-level fixture: exits 1 (regression) when success rate drops on a no-required-tools scenario', () => {
  const baseline = makeResult('qa-cypress-test-implementation', { successes: [true, true], toolUseScore: 2 });
  const newRun = makeResult('qa-cypress-test-implementation', { successes: [false, false], toolUseScore: 2 });

  const result = regression.compareRuns(makeRun([newRun]), makeRun([baseline]));
  assert.equal(result.regressions.length, 1);
  // main() would process.exit(1) in this branch -- verified structurally via
  // compareRuns() (which main() delegates to) rather than spawning the CLI.
});

test('compareRuns reports OK (no regression) when success rate is unchanged', () => {
  const baseline = makeResult('qa-cypress-test-implementation', { successes: [true, true] });
  const newRun = makeResult('qa-cypress-test-implementation', { successes: [true, true] });

  const result = regression.compareRuns(makeRun([newRun]), makeRun([baseline]));
  assert.equal(result.regressions.length, 0);
  assert.equal(result.okLines.length, 1);
});

test('compareRuns skips CI-based gating (warns, no regression) when either side has < 2 replicates', () => {
  const baseline = makeResult('qa-cypress-test-implementation', { successes: [true] });
  const newRun = makeResult('qa-cypress-test-implementation', { successes: [false] });

  const result = regression.compareRuns(makeRun([newRun]), makeRun([baseline]));
  assert.equal(result.regressions.length, 0, 'N<2 on either side must never be flagged as a regression');
  assert.equal(result.okLines.length, 1);
});

test('compareRuns warns and skips a task missing attempts[].success entirely', () => {
  const baseline = { taskId: 'legacy-task', attempts: [{ metrics: { scores: { toolUse: { score: 2 } } } }] };
  const newRun = { taskId: 'legacy-task', attempts: [{ metrics: { scores: { toolUse: { score: 2 } } } }] };

  const result = regression.compareRuns(makeRun([newRun]), makeRun([baseline]));
  assert.equal(result.regressions.length, 0);
  assert.equal(result.okLines.length, 0);
  assert.ok(result.warnings.some((w) => w.includes('legacy-task') && w.includes('attempts[].success')));
});

test('compareRuns warns and skips a task missing from the new run', () => {
  const baseline = makeResult('only-in-baseline', { successes: [true, true] });
  const result = regression.compareRuns(makeRun([]), makeRun([baseline]));
  assert.equal(result.regressions.length, 0);
  assert.ok(result.warnings.some((w) => w.includes('only-in-baseline') && w.includes('missing from new run')));
});

test('compareRuns returns modelMismatch and does not evaluate tasks when models differ', () => {
  const baseline = makeResult('t1', { successes: [true, true] });
  const newRun = makeResult('t1', { successes: [false, false] });

  const result = regression.compareRuns(
    makeRun([newRun], 'claude-opus-4.6'),
    makeRun([baseline], 'claude-sonnet-5'),
  );

  assert.deepEqual(result.modelMismatch, { newModel: 'claude-opus-4.6', baselineModel: 'claude-sonnet-5' });
});

test('compareRuns proceeds (with a warning) when model metadata is missing on one side', () => {
  const baseline = makeResult('t1', { successes: [true, true] });
  const newRun = makeResult('t1', { successes: [true, true] });

  const result = regression.compareRuns(makeRun([newRun], null), makeRun([baseline], 'claude-sonnet-5'));

  assert.equal(result.modelMismatch, null);
  assert.ok(result.warnings.some((w) => w.includes('model ID missing')));
  assert.equal(result.regressions.length, 0);
});
