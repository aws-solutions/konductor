// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pre-registered statistic: two-level bootstrap, verdict words and Holm correction, on small made-up data.

const test = require('node:test');
const assert = require('node:assert/strict');
const { compare, compareRows, bootstrapDraws, verdictWord, pValueOf, usableTasks } = require('../../scenarios/bootstrap.js');
const { BOOTSTRAP, MARGIN, PROTOCOL } = require('../../scenarios/protocol.js');

// Tasks with a fixed gap between arms and a little run noise.
const gap = (n, delta, noise = 2) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, head: [60 + delta + noise, 60 + delta - noise, 60 + delta], base: [60 + noise, 60 - noise, 60] }));

test('the protocol fixes 10,000 draws, a seed and a 5-point margin', () => {
  assert.equal(BOOTSTRAP.draws, 10000);
  assert.equal(MARGIN, 5);
  assert.ok(Number.isInteger(BOOTSTRAP.seed));
});

test('the same data and seed give the same draws; another seed gives other draws', () => {
  const t = gap(6, 8).slice(0, 6);
  const a = bootstrapDraws(t, { draws: 500, seed: 7 });
  const b = bootstrapDraws(t, { draws: 500, seed: 7 });
  const c = bootstrapDraws(t, { draws: 500, seed: 8 });
  assert.deepEqual([...a], [...b]);
  assert.notDeepEqual([...a], [...c]);
  assert.equal(bootstrapDraws(t).length, 10000);
});

test('a clear gain over the margin beats by the margin, a small clear gain beats, a clear loss past the margin loses by the margin, a small one loses', () => {
  const big = compare(gap(8, 20));
  assert.equal(big.verdict, 'beats by the margin');
  assert.equal(big.n, 8);
  assert.ok(Math.abs(big.estimate - 20) < 1e-9);
  assert.ok(big.low > 5 && big.high >= big.estimate);
  assert.equal(compare(gap(8, 3, 0.5)).verdict, 'beats');
  assert.equal(compare(gap(8, -20)).verdict, 'loses by the margin');
  assert.equal(compare(gap(8, -3, 0.5)).verdict, 'loses');
});

test('no difference and no spread is a tie; a wide noisy interval is unsettled', () => {
  assert.equal(compare(gap(6, 0, 0)).verdict, 'ties');
  const noisy = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, head: [90, 20], base: [20, 90] }));
  const wide = compare(noisy.map((t, i) => (i % 2 ? { ...t, head: [30, 31], base: [80, 81] } : { ...t, head: [80, 81], base: [30, 31] })));
  assert.equal(wide.verdict, 'unsettled');
});

test('verdict words follow the owner rule on [L, U] with M = 5, in the order beats by the margin, beats, loses by the margin, loses, ties, unsettled', () => {
  const w = (low, high) => verdictWord({ low, high });
  assert.equal(w(5.01, 9), 'beats by the margin');
  assert.equal(w(5, 9), 'beats', 'L exactly on M is not over it');
  assert.equal(w(0.01, 3), 'beats');
  assert.equal(w(1, 3), 'beats', 'over 0 and inside the margin is beats, not ties');
  assert.equal(w(-9, -5.01), 'loses by the margin');
  assert.equal(w(-9, -5), 'loses', 'U exactly on -M is not under it');
  assert.equal(w(-8, -0.01), 'loses');
  assert.equal(w(-3, -1), 'loses');
  assert.equal(w(0, 3), 'ties', 'L of 0 is not over 0');
  assert.equal(w(-3, 3), 'ties');
  assert.equal(w(-4.99, 4.99), 'ties');
  assert.equal(w(-5, 4), 'unsettled', 'ties needs -M < L');
  assert.equal(w(-4, 5), 'unsettled', 'ties needs U < M');
  assert.equal(w(-6, 2), 'unsettled');
  assert.equal(w(-3, 8), 'unsettled');
  assert.equal(w(null, null), 'unsettled');
  assert.equal(verdictWord({ low: 2, high: 20 }, 1), 'beats by the margin', 'the margin is a parameter');
});

test('the protocol lists the six words in the rule order, and the lock carries them', () => {
  assert.deepEqual(PROTOCOL.verdictOrder, ['beats by the margin', 'beats', 'loses by the margin', 'loses', 'ties', 'unsettled']);
  assert.deepEqual(Object.keys(PROTOCOL.verdictWords), PROTOCOL.verdictOrder);
  assert.match(PROTOCOL.verdictWords['loses by the margin'], /U under -5/);
});

test('D-122 (owner yes, 2026-11-24): the eight single-family batches are in the protocol the lock copies', () => {
  assert.deepEqual(PROTOCOL.singleFamilyBatches.batches, ['t1', 't4', 't5', 't7', 't8', 't10', 't11', 't12']);
  assert.match(PROTOCOL.singleFamilyBatches.decided, /2026-11-24/);
  assert.match(PROTOCOL.singleFamilyBatches.rule, /shown apart/);
});

test('the interval covers the run-level noise too: runs that vary widen it, with the same task means', () => {
  const still = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, head: [70, 70, 70], base: [60, 60, 60] }));
  const noisy = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, head: [50, 70, 90], base: [40, 60, 80] }));
  const a = compare(still);
  const b = compare(noisy);
  assert.equal(a.high - a.low, 0);
  assert.ok(b.high - b.low > 5);
  assert.equal(a.estimate, b.estimate);
});

test('fewer than two tasks with scores in both arms gives no interval and the word unsettled', () => {
  const r = compare([{ id: 'a', head: [80], base: [60] }, { id: 'b', head: [], base: [50] }]);
  assert.deepEqual([r.n, r.low, r.high, r.verdict], [1, null, null, 'unsettled']);
  assert.deepEqual(r.dropped, ['b']);
  assert.equal(r.estimate, 20);
  assert.match(r.note, /fewer than 2 tasks/);
  assert.deepEqual(usableTasks([{ id: 'x', head: [NaN, 5], base: [1] }]).tasks[0].head, [5]);
});

test('p-values come from the draws and are never 0', () => {
  assert.ok(pValueOf(Float64Array.from([1, 2, 3, 4])) > 0);
  assert.equal(pValueOf(Float64Array.from([-3, -2, -1, 1, 2, 3])) > 0.5, true);
});

test('Holm: p-values are adjusted upward, levels widen, and a weak row stays unsettled while a strong one is named', () => {
  const rows = compareRows([
    { key: 'strong', tasks: gap(6, 20) },
    { key: 'weak', tasks: Array.from({ length: 6 }, (_, i) => (i % 2 ? { id: `w${i}`, head: [75, 76], base: [60, 61] } : { id: `w${i}`, head: [55, 56], base: [60, 61] })) },
    { key: 'tiny', tasks: [{ id: 'only', head: [90], base: [10] }] },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(rows.map((r) => r.key), ['strong', 'weak', 'tiny']);
  assert.equal(by.strong.verdict, 'beats by the margin');
  assert.ok(by.strong.pAdj >= by.strong.p);
  assert.ok(by.strong.level > 0.95 && by.strong.level < 1, 'a stricter level than 95% once there are 2 rows');
  assert.equal(by.weak.verdict, 'unsettled');
  assert.equal(by.tiny.verdict, 'unsettled');
  assert.equal(by.tiny.pAdj, null);
  assert.ok(by.weak.pAdj >= by.strong.pAdj, 'adjusted p-values never decrease down the ordered rows');
});

test('Holm: from the first row that fails its threshold on, every later row keeps that row\'s level', () => {
  const mk = (key, delta, noise) => ({ key, tasks: gap(6, delta, noise) });
  const rows = compareRows([mk('a', 20, 1), mk('b', 0, 12), mk('c', 0.5, 12), mk('d', 0, 12)]);
  const ordered = [...rows].sort((x, y) => x.p - y.p);
  const m = ordered.length;
  const f = ordered.findIndex((r, i) => r.p > 0.05 / (m - i));
  assert.ok(f >= 1, 'the strong row passes and a noisy one fails');
  for (let i = 0; i < m; i++) assert.ok(Math.abs(ordered[i].level - (1 - 0.05 / (m - Math.min(i, f)))) < 1e-12, `row ${i}`);
  assert.equal(new Set(ordered.slice(f).map((r) => r.level)).size, 1);
});
