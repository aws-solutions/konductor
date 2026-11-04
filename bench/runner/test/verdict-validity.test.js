// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the platform verdict refuses to call: too few paired task cells, an interval that includes 0 once the runs are paired by task,
// a share of runs that never produced a score, arms scored on different components, and a gain that costs more than the limit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixtureRun, mk, TASKS6 } = require('./verdict-fixtures.js');
const V = require('../../report/verdict.js');

const KEEP = 'KEEP';
const NEE = 'NOT ENOUGH EVIDENCE';
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });
const verdictFor = (v, label) => v.arms.find((a) => a.label === label);
const same = (n) => Object.fromEntries(TASKS6.slice(0, n).map((t) => [t, 7]));

const ARMS = (over = {}) => ({
  vanilla: { hidden: [4], credits: 1 },
  a: { sha: 'a', hidden: [9], credits: 1.5 },
  'a-b': { sha: 'a', hidden: [9], credits: 1.5 },
  ...over,
});

const build = (root, name, o) => {
  const { dir, benchDir } = fixtureRun(root, name, o);
  return V.buildVerdict({ dirs: [dir], benchDir });
};

test('a clear gain on six tasks is KEEP and carries the paired interval, with the unpaired one labelled descriptive', () => {
  const root = mk();
  try {
    const a = verdictFor(build(root, 'r1', { arms: ARMS(), tasks: TASKS6 }), 'a@aaaaaaa');
    assert.equal(a.verdict, KEEP, a.reason);
    assert.equal(a.quality.k, 6);
    assert.equal(a.quality.method, 'paired by cell, t interval');
    assert.ok(a.quality.deltaCiLow > 0);
    assert.ok(a.quality.unpaired && Number.isFinite(a.quality.unpaired.ciLow), 'the unpaired interval stays as a descriptive field');
  } finally { cleanup(root); }
});

test('two paired task cells cannot be KEEP however large the gain', () => {
  const root = mk();
  try {
    const a = verdictFor(build(root, 'r1', { arms: ARMS(), tasks: ['t1', 't2'] }), 'a@aaaaaaa');
    assert.equal(a.verdict, NEE);
    assert.match(a.reason, /fewer than 5 paired task cells \(2\)/);
  } finally { cleanup(root); }
});

test('a gain that is not shared by the tasks is NOT ENOUGH EVIDENCE although the pooled-run interval excludes 0', () => {
  const root = mk();
  try {
    const hiddenByTask = { t1: 10, t2: 10, t3: 10, t4: 3, t5: 3, t6: 3 };
    const arms = { vanilla: { hiddenByTask: same(6) }, a: { sha: 'a', hiddenByTask }, 'a-b': { sha: 'a', hiddenByTask } };
    for (const k of Object.keys(arms.vanilla.hiddenByTask)) arms.vanilla.hiddenByTask[k] = 5;
    const a = verdictFor(build(root, 'r1', { arms, tasks: TASKS6 }), 'a@aaaaaaa');
    assert.ok(a.quality.unpaired.ciLow > 0, `the unpaired interval would have called it: ${a.quality.unpaired.ciLow}`);
    assert.equal(a.verdict, NEE, a.reason);
    assert.match(a.reason, /includes 0/);
  } finally { cleanup(root); }
});

test('an arm with a third of its runs lost to infra errors is NOT ENOUGH EVIDENCE and the counts are shown', () => {
  const root = mk();
  try {
    const arms = ARMS({ a: { sha: 'a', hidden: [9], credits: 1.5, extraFn: (task, rep) => (rep <= 2 ? { infraError: 'stream parse failed' } : {}) } });
    const a = verdictFor(build(root, 'r1', { arms, tasks: TASKS6 }), 'a@aaaaaaa');
    assert.equal(a.verdict, NEE, a.reason);
    assert.match(a.reason, /12 of 30 runs of the arm .* no score/);
    assert.equal(a.nonScored.head.n, 12);
    assert.equal(a.nonScored.head.total, 30);
  } finally { cleanup(root); }
});

test('infra errors on the baseline count against the call too', () => {
  const root = mk();
  try {
    const arms = ARMS({ vanilla: { hidden: [4], credits: 1, extraFn: (task, rep) => (rep <= 2 ? { infraError: 'x' } : {}) }, a: { sha: 'a', hidden: [9], credits: 1.5 }, 'a-b': { sha: 'a', hidden: [9], credits: 1.5 } });
    const a = verdictFor(build(root, 'r1', { arms, tasks: TASKS6 }), 'a@aaaaaaa');
    assert.equal(a.verdict, NEE, a.reason);
    assert.match(a.reason, /12 of 30 runs of vanilla .* no score/);
  } finally { cleanup(root); }
});

test('one infra error in ten stays under the limit and is listed, not hidden', () => {
  const root = mk();
  try {
    const arms = ARMS({ a: { sha: 'a', hidden: [9], credits: 1.5, extraFn: (task, rep) => (task === 't1' && rep === 1 ? { infraError: 'x' } : {}) } });
    const a = verdictFor(build(root, 'r1', { arms, tasks: TASKS6 }), 'a@aaaaaaa');
    assert.equal(a.verdict, KEEP, a.reason);
    assert.equal(a.nonScored.head.n, 1);
    assert.equal(a.failures.infraError, 1);
  } finally { cleanup(root); }
});

test('arms scored on different components are NOT ENOUGH EVIDENCE with the reason', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: ARMS(), tasks: TASKS6 });
    const results = require('node:path').join(dir, 'a', 't1');
    for (const rep of fs.readdirSync(results)) {
      const f = require('node:path').join(results, rep, 'result.json');
      const r = JSON.parse(fs.readFileSync(f, 'utf8'));
      r.checks = [];
      fs.writeFileSync(f, JSON.stringify(r));
    }
    const a = verdictFor(V.buildVerdict({ dirs: [dir], benchDir }), 'a@aaaaaaa');
    assert.equal(a.verdict, NEE, a.reason);
    assert.match(a.reason, /different components/);
    assert.match(a.reason, /t1/);
  } finally { cleanup(root); }
});

test('a gain that costs more than 2.0x per successful run is not a KEEP', () => {
  const root = mk();
  try {
    const arms = ARMS({ a: { sha: 'a', hidden: [9], credits: 3 }, 'a-b': { sha: 'a', hidden: [9], credits: 3 } });
    const a = verdictFor(build(root, 'r1', { arms, tasks: TASKS6 }), 'a@aaaaaaa');
    assert.equal(a.verdict, NEE, a.reason);
    assert.match(a.reason, /costs 3\.00x vanilla per successful run, over the 2\.0x limit/);
  } finally { cleanup(root); }
});

test('decide: a KEEP needs a cost ratio, and a cost ratio over the limit blocks it', () => {
  const base = { cells: 6, pairedCells: 6, nHead: 30, nBase: 30, minReps: 5, rating: 'indicative', ratingBy: [], noise: { available: true, pts: 5 }, quality: { delta: 20, ciLow: 12, ciHigh: 28, p: 0.03, pExact: true }, reliability: { delta: 0, ciLow: -5, ciHigh: 5 }, nonScored: { head: { n: 0, total: 30 }, base: { n: 0, total: 30 } }, components: { ok: true }, cost: { ratio: 1.2 } };
  assert.equal(V.decide(base).verdict, KEEP);
  assert.match(V.decide({ ...base, cost: { ratio: null } }).reason, /cost ratio could not be computed/);
  assert.match(V.decide({ ...base, cost: { ratio: 2.01 } }).reason, /over the 2\.0x limit/);
  assert.equal(V.decide({ ...base, cost: { ratio: 2.0 } }).verdict, KEEP, 'exactly at the limit is within it');
  assert.equal(V.decide({ ...base, quality: { delta: -20, ciLow: -28, ciHigh: -12, p: 0.03, pExact: true }, cost: { ratio: 5 } }).verdict, 'DISCARD', 'a loss is a DISCARD whatever it costs');
});

test('decide: the sign-flip p-value is reported with the interval but does not decide, so more cells never make the rule stricter', () => {
  const base = { cells: 6, pairedCells: 6, nHead: 30, nBase: 30, minReps: 5, rating: 'indicative', ratingBy: [], noise: { available: true, pts: 5 }, quality: { delta: 20, ciLow: 1, ciHigh: 39, p: 0.0625, pExact: true }, reliability: { delta: 0, ciLow: -5, ciHigh: 5 }, nonScored: { head: { n: 0, total: 30 }, base: { n: 0, total: 30 } }, components: { ok: true }, cost: { ratio: 1.2 } };
  assert.equal(V.decide(base).verdict, KEEP);
  assert.equal(V.decide({ ...base, pairedCells: 5, cells: 5 }).verdict, KEEP);
});
