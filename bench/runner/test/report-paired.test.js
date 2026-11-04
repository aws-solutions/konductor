// SPDX-License-Identifier: Apache-2.0
'use strict';

// The paired-by-cell interval that arm-vs-vanilla verdicts rest on, and the checks that keep it honest.

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../report/stats.js');
const { mulberry32 } = require('../../../tests/scripts/stats.js');

const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

// five cells whose per-cell mean difference is +2.0, -1.8, +19.4, +1.4, +9.4
const CELLS = [
  { head: [52, 95, 53, 92, 55], base: [95, 54, 87, 49, 52] },
  { head: [94, 89, 80, 89, 86], base: [96, 88, 94, 80, 89] },
  { head: [95, 49, 58, 50, 48], base: [43, 32, 43, 40, 45] },
  { head: [95, 90, 95, 95, 90], base: [93, 86, 93, 93, 93] },
  { head: [93, 93, 83, 96, 100], base: [96, 78, 76, 83, 85] },
];

test('pairedCellCI: the mean of the per-cell differences with a t interval on the cells', () => {
  const r = S.pairedCellCI(CELLS);
  assert.equal(r.k, 5);
  assert.equal(r.df, 4);
  near(r.delta, 6.08);
  near(r.ciLow, -4.47, 0.1);
  near(r.ciHigh, 16.63, 0.1);
  assert.equal(r.method, 'paired by cell, t interval');
});

test('pairedCellCI: a cell with an empty side is dropped and counted, not zero-filled', () => {
  const r = S.pairedCellCI([...CELLS, { head: [], base: [1, 2, 3] }, { head: [5], base: [] }]);
  assert.equal(r.k, 5);
  assert.equal(r.droppedCells, 2);
  near(r.delta, 6.08);
});

test('pairedCellCI: under two cells there is no interval', () => {
  for (const cells of [[], [CELLS[0]]]) {
    const r = S.pairedCellCI(cells);
    assert.equal(r.ciLow, null);
    assert.equal(r.ciHigh, null);
    assert.equal(r.p, null);
  }
});

test('pairedCellCI: an exact sign-flip p-value, which cannot go below 0.05 with fewer than six cells', () => {
  const same = (k) => Array.from({ length: k }, (_, i) => ({ head: [10 + i], base: [0] }));
  near(S.pairedCellCI(same(5)).p, 2 / 32, 1e-9);
  near(S.pairedCellCI(same(6)).p, 2 / 64, 1e-9);
  assert.equal(S.pairedCellCI(same(6)).pExact, true);
  const mixed = S.pairedCellCI([{ head: [5], base: [0] }, { head: [-5], base: [0] }, { head: [4], base: [0] }, { head: [-4], base: [0] }, { head: [3], base: [0] }, { head: [-3], base: [0] }]);
  assert.equal(mixed.p, 1);
});

test('tQuantile975 rounds the degrees of freedom down, so the interval is never narrower than the exact one', () => {
  near(S.tQuantile975(4), 2.776, 0.001);
  near(S.tQuantile975(30), 2.042, 0.001);
  assert.ok(S.tQuantile975(45) >= 2.0 && S.tQuantile975(45) <= 2.021);
  near(S.tQuantile975(5000), 1.98, 0.001);
});

// ---- measured size ----

function gauss(rng) { let u = 0; while (!u) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }
function nullTrial(rng, k, reps, interaction) {
  const cells = [];
  const pooledHead = [];
  const pooledBase = [];
  for (let t = 0; t < k; t++) {
    const task = 60 + 20 * gauss(rng);
    const shift = interaction * gauss(rng);
    const head = Array.from({ length: reps }, () => task + shift + 12 * gauss(rng));
    const base = Array.from({ length: reps }, () => task + 12 * gauss(rng));
    cells.push({ head, base });
    pooledHead.push(...head);
    pooledBase.push(...base);
  }
  return { cells, pooledHead, pooledBase };
}

test('null simulation: the paired interval excludes 0 about 5% of the time at the minimum cell count, with and without a task-by-arm interaction', () => {
  const rng = mulberry32(2026);
  for (const interaction of [0, 10]) {
    let rejected = 0;
    const trials = 800;
    for (let i = 0; i < trials; i++) {
      const r = S.pairedCellCI(nullTrial(rng, S.MIN_CELLS, 5, interaction).cells);
      if (r.ciLow > 0 || r.ciHigh < 0) rejected++;
    }
    const rate = rejected / trials;
    assert.ok(rate > 0.025 && rate < 0.085, `interaction ${interaction}: ${rate}`);
  }
});

test('null simulation: the old unpaired interval rejects far more than 5% at 3 against 3 runs, which is why it is descriptive only', () => {
  const rng = mulberry32(99);
  let rejected = 0;
  const trials = 600;
  for (let i = 0; i < trials; i++) {
    const a = Array.from({ length: 3 }, () => 50 + 15 * gauss(rng));
    const b = Array.from({ length: 3 }, () => 50 + 15 * gauss(rng));
    const r = S.diffCI(a, b, { seed: i + 1 });
    if (r.ciLow > 0 || r.ciHigh < 0) rejected++;
  }
  assert.ok(rejected / trials > 0.15, String(rejected / trials));
});

test('MIN_CELLS is five, the smallest design the size check above covers', () => {
  assert.equal(S.MIN_CELLS, 5);
});

// ---- spread within a cell ----

test('withinCellSd pools the sample variance of each cell, weighted by its degrees of freedom', () => {
  const r = S.withinCellSd([[1, 3], [10, 10, 10, 16]]);
  // variances 2 (1 df) and 9 (3 df): (2 + 27) / 4 = 7.25
  near(r.sd, Math.sqrt(7.25), 1e-9);
  assert.equal(r.df, 4);
  assert.equal(r.cells, 2);
});

test('withinCellSd skips cells with one run and is null when no cell has two', () => {
  assert.equal(S.withinCellSd([[5], [7]]).sd, null);
  near(S.withinCellSd([[5], [1, 3]]).sd, Math.SQRT2, 1e-9);
});
