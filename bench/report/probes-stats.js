// SPDX-License-Identifier: Apache-2.0
'use strict';

// Small statistics for the constraints probe report: a Wilson interval for a rate and a one-sided Fisher exact test
// for two rates. Plain arithmetic, no dependencies.

const Z95 = 1.959964;

/** Wilson score interval for k successes in n trials. Returns { rate, lo, hi } or null when n is 0. */
function wilson(k, n, z = Z95) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0 || k > n) throw new Error(`wilson needs 0 <= k <= n integers (got ${k}/${n})`);
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { rate: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

const logFact = (() => {
  const cache = [0, 0];
  return (n) => {
    for (let i = cache.length; i <= n; i++) cache[i] = cache[i - 1] + Math.log(i);
    return cache[n];
  };
})();

const logChoose = (n, k) => logFact(n) - logFact(k) - logFact(n - k);

/**
 * One-sided Fisher exact p-value that group A has a higher success rate than group B:
 * the probability, with the margins fixed, of at least `a` successes in group A.
 * a of nA successes in group A, b of nB in group B.
 */
function fisherGreater(a, nA, b, nB) {
  for (const [k, n] of [[a, nA], [b, nB]]) if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k > n) throw new Error(`fisherGreater needs 0 <= k <= n integers (got ${k}/${n})`);
  const total = nA + nB;
  const successes = a + b;
  if (total === 0) return 1;
  const lo = Math.max(0, successes - nB);
  const hi = Math.min(nA, successes);
  let p = 0;
  for (let x = a; x <= hi; x++) {
    if (x < lo) continue;
    p += Math.exp(logChoose(nA, x) + logChoose(nB, successes - x) - logChoose(total, successes));
  }
  return Math.min(1, p);
}

/** Two-sided Fisher exact p-value (sum of tables no more likely than the observed one). */
function fisherTwoSided(a, nA, b, nB) {
  const total = nA + nB;
  const successes = a + b;
  if (total === 0) return 1;
  const lo = Math.max(0, successes - nB);
  const hi = Math.min(nA, successes);
  const prob = (x) => Math.exp(logChoose(nA, x) + logChoose(nB, successes - x) - logChoose(total, successes));
  const observed = prob(a);
  let p = 0;
  for (let x = lo; x <= hi; x++) if (prob(x) <= observed * (1 + 1e-9)) p += prob(x);
  return Math.min(1, p);
}

const fmtRate = (k, n) => (n === 0 ? 'n/a' : `${k}/${n}`);
const fmtInterval = (k, n) => {
  const w = n === 0 ? null : wilson(k, n);
  return w ? `${fmtRate(k, n)} (${(w.rate * 100).toFixed(0)}%, ${(w.lo * 100).toFixed(0)}-${(w.hi * 100).toFixed(0)}%)` : 'n/a';
};

module.exports = { wilson, fisherGreater, fisherTwoSided, fmtRate, fmtInterval, Z95 };
