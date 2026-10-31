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

/** Difference of means, head - base, with a percentile bootstrap interval (independent resampling). Null fields when a side is empty. */
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

module.exports = { median, medianCI, meanCI, ratioCI, ratioBootstrap, diffCI, wilson, mean };
