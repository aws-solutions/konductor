// SPDX-License-Identifier: Apache-2.0
'use strict';

// Trigger scoring: Wilson intervals, precision/recall/F1 over queries, the confusion list and the proxy-vs-live
// cross-check. Known values are worked by hand; each assertion names the number it checks.

const test = require('node:test');
const assert = require('node:assert/strict');
const { wilson, scoreTrigger, crossCheck } = require('../../cap/score.js');

const near = (a, b, eps = 5e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('wilson interval matches hand-worked values', () => {
  const w = wilson(8, 10);
  near(w.lo, 0.4902);
  near(w.hi, 0.9433);
  const z = wilson(0, 10);
  assert.equal(z.lo, 0);
  near(z.hi, 0.2775);
  const all = wilson(10, 10);
  near(all.lo, 0.7225);
  assert.equal(all.hi, 1);
  const half = wilson(5, 10);
  near(half.lo, 0.2366);
  near(half.hi, 0.7634);
  near(wilson(50, 100).lo, 0.4038);
  assert.equal(wilson(0, 0), null);
  assert.throws(() => wilson(11, 10), /k must be between 0 and n/);
});

const rows = (spec) => spec.flatMap(([queryId, expect, hitsByRep, fired = []]) => hitsByRep.map((hit, i) => ({ queryId, expect, rep: i + 1, hit, fired: hit ? [] : fired })));

test('a query is predicted positive when the capability fired in at least half of its repeats', () => {
  const s = scoreTrigger(rows([['q1', 'load', [true, false]], ['q2', 'load', [true, false, false]], ['q3', 'none', [false, true, true]]]));
  const by = Object.fromEntries(s.queries.map((q) => [q.queryId, q]));
  assert.equal(by.q1.predicted, true, '1 of 2 counts as half');
  assert.equal(by.q2.predicted, false);
  assert.equal(by.q3.predicted, true);
  assert.equal(by.q1.rate, 0.5);
  assert.equal(by.q1.pass, true);
  assert.equal(by.q3.pass, false, 'a load on an expect:none query is a false trigger');
});

test('precision, recall and F1 follow the confusion counts, with Wilson intervals', () => {
  // 8 should-load: 6 fire, 2 miss. 10 should-not: 2 fire, 8 do not.
  const spec = [];
  for (let i = 0; i < 8; i++) spec.push([`l${i}`, 'load', [i < 6]]);
  for (let i = 0; i < 10; i++) spec.push([`n${i}`, 'none', [i < 2]]);
  const s = scoreTrigger(rows(spec));
  assert.deepEqual([s.tp, s.fp, s.fn, s.tn], [6, 2, 2, 8]);
  assert.equal(s.precision.value, 0.75);
  assert.equal(s.recall.value, 0.75);
  assert.equal(s.f1.value, 12 / 16);
  near(s.precision.lo, wilson(6, 8).lo);
  near(s.recall.hi, wilson(6, 8).hi);
  near(s.f1.lo, wilson(12, 16).lo);
  assert.equal(s.precision.n, 8);
  assert.equal(s.f1.n, 16);
});

test('precision is null when nothing fired and recall is null when nothing was expected to load', () => {
  const s = scoreTrigger(rows([['n1', 'none', [false]], ['n2', 'none', [false]]]));
  assert.equal(s.precision.value, null);
  assert.equal(s.recall.value, null);
  assert.equal(s.f1.value, null);
  assert.equal(s.tn, 2);
});

test('the confusion list names what fired instead of the capability, for misses and for false triggers', () => {
  const r = [
    { queryId: 'q1', expect: 'load', rep: 1, hit: false, fired: ['frontend-review'] },
    { queryId: 'q1', expect: 'load', rep: 2, hit: false, fired: ['frontend-review', 'sprint-planning'] },
    { queryId: 'q2', expect: 'none', rep: 1, hit: true, fired: ['frontend-review'] },
    { queryId: 'q3', expect: 'none', rep: 1, hit: false, fired: [] },
  ];
  const s = scoreTrigger(r);
  assert.deepEqual(s.confusion.map((c) => c.queryId), ['q1', 'q2']);
  assert.deepEqual(s.confusion[0].fired, { 'frontend-review': 2, 'sprint-planning': 1 });
  assert.deepEqual(s.confusionCounts, { 'frontend-review': 3, 'sprint-planning': 1 });
});

test('rows without a rep structure score as single repeats and unknown expectations are refused', () => {
  assert.equal(scoreTrigger([{ queryId: 'a', expect: 'load', hit: true }]).queries[0].reps, 1);
  assert.throws(() => scoreTrigger([{ queryId: 'a', expect: 'maybe', hit: true }]), /expect must be load or none/);
});

test('Cohen kappa and agreement on the cross-check sample match worked values, and the sign is right', () => {
  // 50 items: both hit 20, proxy hit only 5, live hit only 10, neither 15 -> po 0.7, pe 0.5, kappa 0.4
  const pairs = [];
  const add = (n, proxy, live) => { for (let i = 0; i < n; i++) pairs.push({ queryId: `q${pairs.length}`, proxy, live }); };
  add(20, true, true); add(5, true, false); add(10, false, true); add(15, false, false);
  const c = crossCheck(pairs);
  assert.equal(c.n, 50);
  assert.equal(c.agreement, 0.7);
  near(c.kappa, 0.4, 1e-9);
  assert.equal(c.validated, false);
  assert.match(c.label, /proxy not validated \(kappa 0\.40 < 0\.6\)/);
  const opposite = [];
  for (let i = 0; i < 6; i++) opposite.push({ queryId: `a${i}`, proxy: true, live: false }, { queryId: `b${i}`, proxy: false, live: true });
  near(crossCheck(opposite).kappa, -1, 1e-9);
});

test('the proxy is validated only at kappa 0.6 or more on at least 12 queries', () => {
  const mk = (n, agree) => Array.from({ length: n }, (_, i) => ({ queryId: `q${i}`, proxy: i % 2 === 0, live: i < agree ? i % 2 === 0 : i % 2 !== 0 }));
  const good = crossCheck(mk(20, 20));
  assert.equal(good.kappa, 1);
  assert.equal(good.validated, true);
  assert.equal(good.label, 'proxy validated (kappa 1.00, agreement 100%, n=20)');
  const small = crossCheck(mk(8, 8));
  assert.equal(small.validated, false);
  assert.match(small.label, /proxy not validated \(n=8, need at least 12\)/);
  const flat = crossCheck(Array.from({ length: 12 }, (_, i) => ({ queryId: `q${i}`, proxy: false, live: false })));
  assert.equal(flat.kappa, null);
  assert.equal(flat.validated, false);
  assert.match(flat.label, /kappa undefined/);
  assert.equal(crossCheck([]).n, 0);
});
