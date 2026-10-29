// SPDX-License-Identifier: Apache-2.0
'use strict';

const { mulberry32, mean, bootstrapCI } = require('../../tests/scripts/stats.js');

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

module.exports = { median, medianCI, meanCI, ratioCI, mean };
