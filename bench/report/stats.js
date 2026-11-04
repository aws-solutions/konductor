// SPDX-License-Identifier: Apache-2.0
'use strict';

const { mulberry32, mean, bootstrapCI } = require('../../tests/scripts/stats.js');
const { wilson } = require('../cap/score.js');

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// tests/scripts/stats.js only bootstraps a mean, so the median variant reuses its seeded PRNG.
function medianCI(values, { confidence = 0.95, nResamples = 2000, seed = 42 } = {}) {
  const n = values.length;
  if (!n) return { n: 0, median: null, ciLow: null, ciHigh: null };
  const obs = median(values);
  if (n === 1) return { n, median: obs, ciLow: obs, ciHigh: obs };
  const rng = mulberry32(seed);
  const boots = new Array(nResamples);
  for (let i = 0; i < nResamples; i++) {
    const s = new Array(n);
    for (let j = 0; j < n; j++) s[j] = values[Math.floor(rng() * n)];
    boots[i] = median(s);
  }
  boots.sort((a, b) => a - b);
  const alpha = 1 - confidence;
  return {
    n, median: obs,
    ciLow: boots[Math.max(0, Math.floor((alpha / 2) * nResamples))],
    ciHigh: boots[Math.min(nResamples - 1, Math.ceil((1 - alpha / 2) * nResamples) - 1)],
  };
}

// Mean with a bootstrap CI, from the shared helper.
function meanCI(values, opts) {
  if (!values.length) return { n: 0, mean: null, ciLow: null, ciHigh: null };
  const r = bootstrapCI(values, opts);
  return { n: values.length, mean: r.mean, ciLow: r.ciLow, ciHigh: r.ciHigh };
}

// pairs: [[credits, succeeded 0|1], ...]. Ratio of sums, bootstrapped over runs.
function ratioCI(pairs, { confidence = 0.95, nResamples = 2000, seed = 42 } = {}) {
  const ratio = (ps) => {
    const succ = ps.reduce((s, p) => s + p[1], 0);
    return succ ? ps.reduce((s, p) => s + p[0], 0) / succ : Infinity;
  };
  const obs = ratio(pairs);
  if (!pairs.length || obs === Infinity) return { n: pairs.length, value: null, ciLow: null, ciHigh: null };
  const rng = mulberry32(seed);
  const boots = Array.from({ length: nResamples }, () => ratio(pairs.map(() => pairs[Math.floor(rng() * pairs.length)])));
  boots.sort((a, b) => a - b);
  const alpha = 1 - confidence;
  return {
    n: pairs.length, value: obs,
    ciLow: boots[Math.max(0, Math.floor((alpha / 2) * nResamples))],
    ciHigh: boots[Math.min(nResamples - 1, Math.ceil((1 - alpha / 2) * nResamples) - 1)],
  };
}

/**
 * Ratio of a statistic over two independent samples, head / base, with a percentile bootstrap interval.
 * `stat` maps a list of items to a number or null; a resample where either side has no value, or the base is 0, is skipped.
 */
function ratioBootstrap(headItems, baseItems, stat, { confidence = 0.95, nResamples = 2000, seed = 42 } = {}) {
  const h = stat(headItems);
  const b = stat(baseItems);
  const out = { head: h, base: b, ratio: null, ciLow: null, ciHigh: null };
  if (h === null || b === null || b === 0) return out;
  out.ratio = h / b;
  if (headItems.length < 2 && baseItems.length < 2) { out.ciLow = out.ratio; out.ciHigh = out.ratio; return out; }
  const rng = mulberry32(seed);
  const draw = (xs) => xs.map(() => xs[Math.floor(rng() * xs.length)]);
  const boots = [];
  for (let i = 0; i < nResamples; i++) {
    const bh = stat(draw(headItems));
    const bb = stat(draw(baseItems));
    if (bh !== null && bb !== null && bb !== 0) boots.push(bh / bb);
  }
  if (boots.length < nResamples / 2) return out;
  boots.sort((x, y) => x - y);
  const alpha = 1 - confidence;
  out.ciLow = boots[Math.max(0, Math.floor((alpha / 2) * boots.length))];
  out.ciHigh = boots[Math.min(boots.length - 1, Math.ceil((1 - alpha / 2) * boots.length) - 1)];
  return out;
}

/**
 * Difference of means, head - base, with a percentile bootstrap interval (independent resampling). Null fields when a side is empty.
 * Descriptive only: it treats every run as independent, so it ignores that both arms ran the same tasks. It rejects 0 about 20% of the
 * time at 3 runs a side when there is no effect. Verdicts use pairedCellCI.
 */
function diffCI(headVals, baseVals, { confidence = 0.95, nResamples = 2000, seed = 42 } = {}) {
  if (!headVals.length || !baseVals.length) return { delta: null, ciLow: null, ciHigh: null, nHead: headVals.length, nBase: baseVals.length };
  const delta = mean(headVals) - mean(baseVals);
  const out = { delta, ciLow: delta, ciHigh: delta, nHead: headVals.length, nBase: baseVals.length };
  if (headVals.length < 2 && baseVals.length < 2) return out;
  const rng = mulberry32(seed);
  const m = (xs) => { let t = 0; for (let i = 0; i < xs.length; i++) t += xs[Math.floor(rng() * xs.length)]; return t / xs.length; };
  const boots = Array.from({ length: nResamples }, () => m(headVals) - m(baseVals)).sort((a, b) => a - b);
  const alpha = 1 - confidence;
  out.ciLow = boots[Math.max(0, Math.floor((alpha / 2) * nResamples))];
  out.ciHigh = boots[Math.min(nResamples - 1, Math.ceil((1 - alpha / 2) * nResamples) - 1)];
  return out;
}

// Two-sided 95% critical values of Student's t by degrees of freedom. A df between table entries uses the next lower entry,
// which is the wider interval.
const T975 = [[1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [6, 2.447], [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228], [11, 2.201], [12, 2.179], [13, 2.16], [14, 2.145], [15, 2.131], [16, 2.12], [17, 2.11], [18, 2.101], [19, 2.093], [20, 2.086], [21, 2.08], [22, 2.074], [23, 2.069], [24, 2.064], [25, 2.06], [26, 2.056], [27, 2.052], [28, 2.048], [29, 2.045], [30, 2.042], [40, 2.021], [60, 2.0], [120, 1.98]];

function tQuantile975(df) {
  let out = T975[0][1];
  for (const [d, q] of T975) if (d <= df) out = q;
  return out;
}

// Student's t quantile for any probability, by inverting the CDF (regularized incomplete beta, continued fraction) with bisection.
function logGamma(x) {
  const c = [76.18009173, -86.50532033, 24.01409824, -1.231739572, 1.208651e-3, -5.395239e-6];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.00000000019;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(Math.sqrt(2 * Math.PI) * ser / x);
}

function betaCf(a, b, x) {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaCf(a, b, x)) / a : 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

function tCdf(x, df) {
  const tail = 0.5 * incompleteBeta(df / 2, 0.5, df / (df + x * x));
  return x > 0 ? 1 - tail : tail;
}

/** The t value whose CDF is p, for p in (0, 1) and df >= 1. */
function tQuantile(p, df) {
  if (!(p > 0 && p < 1) || !(df >= 1)) return NaN;
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  let lo = 0;
  let hi = 1;
  while (tCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// The fewest cells (task by run directory) a paired comparison may rest on. With 5 to 12 cells of 5 replicates, a task effect SD of 20 and
// a run SD of 12 (also a pass/fail mixture, also with a task-by-arm interaction), the t interval below excluded 0 in 4.1% to 6.5% of
// null trials (bench/scripts/sim-interval-size.js). The sign-flip p is reported beside it; it cannot go below 0.05 under 6 cells, so it
// does not decide.
const MIN_CELLS = 5;
const EXACT_FLIP_MAX = 16;

function signFlipP(diffs, seed = 42) {
  const k = diffs.length;
  const obs = Math.abs(diffs.reduce((a, b) => a + b, 0));
  const eps = 1e-9 * Math.max(1, obs);
  if (k <= EXACT_FLIP_MAX) {
    let ge = 0;
    const total = 2 ** k;
    for (let s = 0; s < total; s++) {
      let t = 0;
      for (let i = 0; i < k; i++) t += (s >> i) & 1 ? diffs[i] : -diffs[i];
      if (Math.abs(t) >= obs - eps) ge++;
    }
    return { p: ge / total, exact: true };
  }
  const rng = mulberry32(seed);
  const n = 20000;
  let ge = 1;
  for (let j = 0; j < n; j++) {
    let t = 0;
    for (let i = 0; i < k; i++) t += rng() < 0.5 ? diffs[i] : -diffs[i];
    if (Math.abs(t) >= obs - eps) ge++;
  }
  return { p: ge / (n + 1), exact: false };
}

/**
 * Head minus base, paired by cell. cells: [{ head: number[], base: number[] }], one per task (and run directory) both arms ran.
 * The unit is the cell: each cell contributes the difference of its two means, the mean of those differences is the estimate, and the
 * interval is a t interval on the cells (df = k - 1). Replicates inside a cell and a task-by-arm interaction are carried by the spread
 * of the cell differences, which an interval over pooled runs does not see. A cell with an empty side is dropped and counted.
 */
/**
 * Paired-by-cell t interval. `comparisons` is the number of comparisons made together (arms against one baseline); the
 * interval is widened to level 1 - 0.05/comparisons (Bonferroni) and p is multiplied by it. One comparison is the plain 95%.
 */
function pairedCellCI(cells, { comparisons = 1 } = {}) {
  const nComp = Math.max(1, Math.floor(comparisons));
  const level = nComp === 1 ? 0.95 : 1 - 0.05 / nComp;
  const usable = cells.filter((c) => c.head.length && c.base.length);
  const droppedCells = cells.length - usable.length;
  const diffs = usable.map((c) => mean(c.head) - mean(c.base));
  const k = diffs.length;
  const out = { k, droppedCells, df: Math.max(0, k - 1), delta: k ? mean(diffs) : null, se: null, ciLow: null, ciHigh: null, p: null, pExact: null, method: 'paired by cell, t interval', level, comparisons: nComp, pAdjusted: null };
  if (k < 2) return out;
  const m = out.delta;
  const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - m) ** 2, 0) / (k - 1));
  out.se = sd / Math.sqrt(k);
  const crit = nComp === 1 ? tQuantile975(k - 1) : Math.max(tQuantile975(k - 1), tQuantile(1 - (1 - level) / 2, k - 1));
  const h = crit * out.se;
  out.ciLow = m - h;
  out.ciHigh = m + h;
  const flip = signFlipP(diffs);
  out.p = flip.p;
  out.pExact = flip.exact;
  out.pAdjusted = Math.min(1, flip.p * nComp);
  return out;
}

/** Pooled within-cell standard deviation: sqrt(sum of (n-1) * variance / sum of (n-1)) over cells with two or more values. */
function withinCellSd(groups) {
  let ss = 0;
  let df = 0;
  let cells = 0;
  for (const g of groups) {
    if (g.length < 2) continue;
    const m = mean(g);
    ss += g.reduce((s, x) => s + (x - m) ** 2, 0);
    df += g.length - 1;
    cells++;
  }
  return { sd: df ? Math.sqrt(ss / df) : null, df, cells };
}

module.exports = { median, medianCI, meanCI, ratioCI, ratioBootstrap, diffCI, pairedCellCI, withinCellSd, tQuantile975, tQuantile, signFlipP, MIN_CELLS, wilson, mean };
