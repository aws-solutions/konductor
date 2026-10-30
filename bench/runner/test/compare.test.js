// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun, writeJudgments } = require('./helpers.js');
const { compareRuns, relChange } = require('../../report/compare.js');

const FAIL = [{ type: 'file_exists', path: 'a.txt', passed: false }];
const reps = (arm, f) => [1, 2, 3].map((rep) => ({ arm, rep, ...f(rep) }));

function pair(baseSpecs, headSpecs, { baseCfg, headCfg, baseJ, headJ } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const base = makeRun(path.join(root, 'base'), bench, baseSpecs, baseCfg);
  const head = makeRun(path.join(root, 'head'), bench, headSpecs, headCfg);
  if (baseJ) writeJudgments(base, baseJ);
  if (headJ) writeJudgments(head, headJ);
  return { root, base, head, bench };
}
const run = (p, opts = {}) => compareRuns({ baseDir: p.base, headDir: p.head, benchDir: p.bench, ...opts });
const done = (p) => fs.rmSync(p.root, { recursive: true, force: true });

test('relChange handles zero bases', () => {
  assert.equal(relChange(10, 12), 0.2);
  assert.equal(relChange(0, 0), 0);
  assert.equal(relChange(0, 1), Infinity);
});

test('a run compared to itself has no regressions and exits 0', () => {
  const specs = reps('a', (i) => ({ credits: 1 + i }));
  const p = pair(specs, specs);
  try {
    const r = run(p);
    assert.equal(r.exitCode, 0);
    assert.equal(r.regressions.length, 0);
    assert.equal(r.refusals.length, 0);
  } finally { done(p); }
});

test('efficiency worse beyond the threshold is a regression (exit 1); a small change is not', () => {
  const p = pair(reps('a', () => ({ credits: 1 })), reps('a', () => ({ credits: 2 })));
  const small = pair(reps('a', () => ({ credits: 1 })), reps('a', () => ({ credits: 1.1 })));
  try {
    const r = run(p);
    assert.equal(r.exitCode, 1);
    const hit = r.regressions.find((x) => x.metric === 'credits' && x.scope === 'overall');
    assert.ok(hit);
    assert.equal(hit.direction, 'worse');
    assert.equal(run(small).exitCode, 0);
    assert.equal(run(small, { minRel: 0.05 }).exitCode, 1);
  } finally { done(p); done(small); }
});

test('quality worse is a regression; better is reported as an improvement', () => {
  const good = reps('a', () => ({ credits: 1 }));
  const bad = reps('a', () => ({ credits: 1, checks: FAIL }));
  const p = pair(good, bad);
  try {
    const down = run(p);
    assert.equal(down.exitCode, 1);
    assert.ok(down.regressions.some((x) => x.metric === 'checkPassRate'));
    const up = compareRuns({ baseDir: p.head, headDir: p.base, benchDir: p.bench });
    assert.equal(up.exitCode, 0);
    assert.ok(up.improvements.some((x) => x.metric === 'checkPassRate'));
  } finally { done(p); }
});

test('rubric score drop is a regression', () => {
  const specs = reps('a', () => ({}));
  const j = (s) => ({ judges: ['j'], rubric: [1, 2, 3].map((rep) => ({ judge: 'j', arm: 'a', rep, score: s })) });
  const p = pair(specs, specs, { baseJ: j(0.9), headJ: j(0.5) });
  try {
    const r = run(p);
    assert.equal(r.exitCode, 1);
    assert.ok(r.regressions.some((x) => x.metric === 'rubricScore'));
  } finally { done(p); }
});

test('with 3 or more runs, a big median shift inside overlapping CIs is not flagged under the default rule', () => {
  const p = pair(
    [1, 2, 3].map((rep) => ({ arm: 'a', rep, credits: [1, 5, 9][rep - 1] })),
    [1, 2, 3].map((rep) => ({ arm: 'a', rep, credits: [2, 6, 10][rep - 1] })),
  );
  try {
    assert.equal(run(p).exitCode, 0);
    assert.equal(run(p, { rule: 'any' }).exitCode, 1);
  } finally { done(p); }
});

test('refuses when model, effort, task set, or judge set differ; --force overrides', () => {
  const specs = reps('a', () => ({}));
  const cases = [
    [{ headCfg: { model: 'other-model' } }, /model/],
    [{ headCfg: { effort: 'low' } }, /effort/],
    [{ headCfg: { taskIds: ['t1', 't9'] } }, /task set/],
    [{ baseCfg: { agentEngine: 'v2' }, headCfg: { agentEngine: 'v3' } }, /agent engine differs: base "v2" vs head "v3"/],
    [{ headCfg: { agentEngine: 'v3' } }, /agent engine/],
    [{ baseJ: { judges: ['j1'] }, headJ: { judges: ['j2'] } }, /judge/],
    [{ baseJ: { judges: ['j1'] } }, /judge/],
  ];
  for (const [opts, re] of cases) {
    const p = pair(specs, specs, opts);
    try {
      const r = run(p);
      assert.equal(r.exitCode, 2, String(re));
      assert.match(r.refusals.join(' '), re);
      assert.equal(run(p, { force: true }).exitCode, 0);
    } finally { done(p); }
  }
});

test('a run written before --agent-engine existed counts as v2', () => {
  const specs = reps('a', () => ({}));
  const p = pair(specs, specs, { headCfg: { agentEngine: 'v2' } });
  try {
    assert.equal(run(p).refusals.length, 0);
  } finally { done(p); }
});

test('arms present on only one side are listed, not compared', () => {
  const p = pair(reps('a', () => ({})), [...reps('a', () => ({})), ...reps('b', () => ({}))]);
  try {
    const r = run(p);
    assert.deepEqual(r.onlyInHead, ['b']);
    assert.deepEqual(r.onlyInBase, []);
  } finally { done(p); }
});
