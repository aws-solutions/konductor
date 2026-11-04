// SPDX-License-Identifier: Apache-2.0
'use strict';

// The A/A noise is pooled over every paired cell of the A/A repeat: the larger end of the 95% interval of the
// per-cell differences between an arm and its repeat. The old figure, the largest gap between two overall means,
// let opposite shifts cancel and swung with one draw.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixtureRun, mk, TASKS6 } = require('./verdict-fixtures.js');
const { mulberry32 } = require('../../../tests/scripts/stats.js');
const { pairedCellCI } = require('../../report/stats.js');
const V = require('../../report/verdict.js');
const op = require('../../report/orchpass.js');

const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const NEE = 'NOT ENOUGH EVIDENCE';
const cell = (a, b) => ({ head: a, base: b });

test('aaNoiseFromCells is the larger end of the paired 95% interval of A minus A-prime over all cells', () => {
  const cells = [[2, 0], [4, 0], [6, 0], [4, 0], [4, 0], [4, 0]].map(([a, b]) => cell([a], [b]));
  const n = V.aaNoiseFromCells(cells);
  assert.equal(n.k, 6);
  assert.ok(Math.abs(n.meanDiff - 4) < 1e-9);
  assert.ok(Math.abs(n.pts - (4 + 2.571 * Math.sqrt(1.6) / Math.sqrt(6))) < 0.01, String(n.pts));
});

test('aaNoiseFromCells needs two paired cells and ignores a cell with a side that has no score', () => {
  assert.equal(V.aaNoiseFromCells([cell([5], [5])]).available, false);
  assert.equal(V.aaNoiseFromCells([cell([5], [5]), cell([], [3]), cell([4], [])]).available, false);
  assert.equal(V.aaNoiseFromCells([cell([5], [5]), cell([6], [5])]).available, true);
});

test('the pooled noise is never below the gap between the two overall means when cells are balanced', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 200; i++) {
    const k = 2 + Math.floor(rng() * 8);
    const cells = Array.from({ length: k }, () => cell([rng() * 100, rng() * 100, rng() * 100], [rng() * 100, rng() * 100, rng() * 100]));
    const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const oldGap = Math.abs(mean(cells.flatMap((c) => c.head)) - mean(cells.flatMap((c) => c.base)));
    assert.ok(V.aaNoiseFromCells(cells).pts >= oldGap - 1e-9, `k=${k}`);
  }
});

// Two identical arms: how often does a second, independent comparison of identical arms beat the noise estimate?
// Without the floor, the old figure is a second draw of the same quantity, so it loses about half the time.
function gaussian(rng) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }

test('simulation: the old single-gap estimate lets about half of null differences through; the pooled one stays near 5 percent', () => {
  const rng = mulberry32(2024);
  const SIGMA = 15, REPS = 3, K = 6, TRIALS = 1500;
  const cellsOf = () => Array.from({ length: K }, () => cell(Array.from({ length: REPS }, () => SIGMA * gaussian(rng)), Array.from({ length: REPS }, () => SIGMA * gaussian(rng))));
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  let oldWrong = 0, newWrong = 0;
  const oldSeries = [], newSeries = [];
  for (let i = 0; i < TRIALS; i++) {
    const aa = cellsOf();
    const oldNoise = Math.abs(mean(aa.flatMap((c) => c.head)) - mean(aa.flatMap((c) => c.base)));
    const newNoise = V.aaNoiseFromCells(aa).pts;
    const nullDelta = Math.abs(pairedCellCI(cellsOf()).delta);
    if (nullDelta > oldNoise) oldWrong++;
    if (nullDelta > newNoise) newWrong++;
    oldSeries.push(oldNoise);
    newSeries.push(newNoise);
  }
  const cv = (xs) => Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / xs.length) / mean(xs);
  assert.ok(oldWrong / TRIALS > 0.4, `old false-call rate ${oldWrong / TRIALS}`);
  assert.ok(newWrong / TRIALS < 0.1, `pooled false-call rate ${newWrong / TRIALS}`);
  assert.ok(cv(oldSeries) > 0.6, `old estimate spread (cv) ${cv(oldSeries)}`);
  assert.ok(cv(newSeries) < 0.45, `pooled estimate spread (cv) ${cv(newSeries)}`);
});

// Opposite shifts in the repeat cancel in the overall means. Six tasks: the repeat is 4 tests better on three and 4 worse on three.
const CANCEL = {
  vanilla: { hidden: [4], credits: 5 },
  a: { sha: 'a', hiddenByTask: { t1: 9, t2: 9, t3: 9, t4: 5, t5: 5, t6: 5 }, credits: 8 },
  'a-b': { sha: 'a', hiddenByTask: { t1: 5, t2: 5, t3: 5, t4: 9, t5: 9, t6: 9 }, credits: 8 },
};

test('platform verdict: cancelling A/A shifts no longer give a 5-point noise floor and a KEEP', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms: CANCEL, tasks: TASKS6 });
    const a = V.buildVerdict({ dirs: [dir], benchDir }).arms.find((x) => x.label === 'a@aaaaaaa');
    assert.ok(a.noise.spread < 1, `the old single-gap figure is near zero: ${a.noise.spread}`);
    assert.ok(a.noise.pts > 25, `the pooled noise sees the cell shifts: ${a.noise.pts}`);
    assert.equal(a.noise.method, 'pooled over paired A/A cells');
    assert.equal(a.noise.pairs[0].cells, 6);
    assert.ok(a.quality.delta > 15 && a.quality.delta < a.noise.pts, `delta ${a.quality.delta}`);
    assert.equal(a.verdict, NEE);
    assert.match(a.reason, /inside the A\/A noise/);
  } finally { rm(root); }
});

test('platform verdict: a steady A/A pair keeps the 5-point floor', () => {
  const root = mk();
  try {
    const arms = { vanilla: { hidden: [4], credits: 1 }, a: { sha: 'a', hidden: [9], credits: 1.5 }, 'a-b': { sha: 'a', hidden: [9], credits: 1.5 } };
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms, tasks: TASKS6 });
    const a = V.buildVerdict({ dirs: [dir], benchDir }).arms.find((x) => x.label === 'a@aaaaaaa');
    assert.equal(a.noise.pts, 5);
    assert.equal(a.verdict, 'KEEP', a.reason);
  } finally { rm(root); }
});

test('platform verdict: an A/A repeat with a single paired cell is not a noise floor', () => {
  const root = mk();
  try {
    const arms = { vanilla: { hidden: [4], credits: 1 }, a: { sha: 'a', hidden: [9], credits: 1.5 }, 'a-b': { sha: 'a', hidden: [9], credits: 1.5, extraFn: (task) => (task === 't1' ? {} : { status: 'error', infraError: 'agent never started', checks: [], hiddenTests: undefined }) } };
    const { dir, benchDir } = fixtureRun(root, 'r1', { arms, tasks: TASKS6 });
    const a = V.buildVerdict({ dirs: [dir], benchDir }).arms.find((x) => x.label === 'a@aaaaaaa');
    assert.equal(a.noise.available, false);
    assert.match(a.reason, /no A\/A noise floor/);
  } finally { rm(root); }
});

test('orchestrator pass rule: cancelling A/A shifts make the quality criterion uncertain', () => {
  const root = mk();
  try {
    const meta = { model: 'claude-sonnet-5.5', agentEngine: 'v3', harness: 'kiro-cli' };
    const withMeta = Object.fromEntries(Object.entries(CANCEL).map(([k, v]) => [k, { ...v, extra: meta }]));
    withMeta.vanilla.hidden = [7, 8, 9, 8, 8];
    withMeta.vanilla.credits = 5;
    const fx = fixtureRun(root, 'c1', { arms: withMeta, reps: 5, tasks: TASKS6, config: { model: meta.model, agentEngine: 'v3', harness: 'kiro-cli' } });
    const cellOut = op.buildOrchestratorPass({ dirs: [fx.dir], benchDir: fx.benchDir, baseline: 'vanilla' }).cells[0];
    const a = cellOut.arms.find((x) => x.armId === 'a');
    assert.ok(cellOut.aa.qualityDrift > 25, `drift ${cellOut.aa.qualityDrift}`);
    assert.equal(cellOut.aa.pairs[0].cells, 6);
    assert.notEqual(a.call, op.PASS);
  } finally { rm(root); }
});
