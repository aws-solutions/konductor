// SPDX-License-Identifier: Apache-2.0
/**
 * Statistical helpers: bootstrap CI on a mean / mean delta.
 *
 * Pure math, Node stdlib only, with zero external dependencies.
 *
 * All functions are pure (no I/O) and dependency-free (Node stdlib only).
 */

'use strict';

/**
 * Deterministic seeded PRNG (mulberry32). Node's Math.random() cannot be
 * seeded, so a fixed-seed generator is required to make bootstrap resampling
 * reproducible across runs. Not cryptographic; fine for resampling.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Non-parametric percentile bootstrap CI on the mean of `values`.
 *
 * @param {number[]} values flat list of (scenario x replicate) scores/deltas
 * @param {{confidence?: number, nResamples?: number, seed?: number}} [opts]
 * @returns {{mean:number, ciLow:number, ciHigh:number, nResamples:number}}
 */
function bootstrapCI(values, opts = {}) {
  const { confidence = 0.95, nResamples = 2000, seed = 42 } = opts;

  if (!values || values.length === 0) {
    return { mean: NaN, ciLow: NaN, ciHigh: NaN, nResamples: 0 };
  }

  const rng = mulberry32(seed);
  const n = values.length;
  const observedMean = mean(values);

  const bootMeans = new Array(nResamples);
  for (let i = 0; i < nResamples; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += values[Math.floor(rng() * n)];
    }
    bootMeans[i] = sum / n;
  }
  bootMeans.sort((a, b) => a - b);

  const alpha = 1 - confidence;
  const loIdx = Math.floor((alpha / 2) * nResamples);
  const hiIdx = Math.ceil((1 - alpha / 2) * nResamples) - 1;

  return {
    mean: observedMean,
    ciLow: bootMeans[Math.max(0, loIdx)],
    ciHigh: bootMeans[Math.min(nResamples - 1, hiIdx)],
    nResamples,
  };
}

/**
 * Two-sample bootstrap CI on the difference of means (newValues - baseValues),
 * used when replicate counts differ between a new run and its baseline and a
 * paired per-index delta is not available. Resamples each side independently.
 *
 * @param {number[]} newValues
 * @param {number[]} baseValues
 * @param {{confidence?: number, nResamples?: number, seed?: number}} [opts]
 */
function twoSampleBootstrapCI(newValues, baseValues, opts = {}) {
  const { confidence = 0.95, nResamples = 2000, seed = 42 } = opts;

  if (!newValues?.length || !baseValues?.length) {
    return { mean: NaN, ciLow: NaN, ciHigh: NaN, nResamples: 0 };
  }

  const rng = mulberry32(seed);
  const nNew = newValues.length;
  const nBase = baseValues.length;
  const observedMean = mean(newValues) - mean(baseValues);

  const bootDeltas = new Array(nResamples);
  for (let i = 0; i < nResamples; i++) {
    let sumNew = 0;
    for (let j = 0; j < nNew; j++) sumNew += newValues[Math.floor(rng() * nNew)];
    let sumBase = 0;
    for (let j = 0; j < nBase; j++) sumBase += baseValues[Math.floor(rng() * nBase)];
    bootDeltas[i] = sumNew / nNew - sumBase / nBase;
  }
  bootDeltas.sort((a, b) => a - b);

  const alpha = 1 - confidence;
  const loIdx = Math.floor((alpha / 2) * nResamples);
  const hiIdx = Math.ceil((1 - alpha / 2) * nResamples) - 1;

  return {
    mean: observedMean,
    ciLow: bootDeltas[Math.max(0, loIdx)],
    ciHigh: bootDeltas[Math.min(nResamples - 1, hiIdx)],
    nResamples,
  };
}

module.exports = { mulberry32, mean, bootstrapCI, twoSampleBootstrapCI };
