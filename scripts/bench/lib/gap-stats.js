// SPDX-License-Identifier: Apache-2.0
/**
 * Statistics of a list of per-task gaps: the mean, a 95% t interval and a 95% paired bootstrap interval. Pure: no
 * file access, no clock and no global random source, so the same gaps give the same numbers on every machine.
 *
 * A gap is one number per task (for example the MET rate of the with answer minus the MET rate of the without
 * answer). Each task is one point, so a task with many items or many judge seats does not weigh more than one with few.
 *
 *   t interval          mean +/- t(0.975, df = n - 1) * sd / sqrt(n), with the sample standard deviation (n - 1).
 *   bootstrap interval  the tasks are resampled with replacement BOOTSTRAP_RESAMPLES times from a fixed seed
 *                       (BOOTSTRAP_SEED); the interval is the 2.5th and 97.5th percentile of the resampled means.
 *                       "Paired" because a task's gap keeps its two rates together: the arms are never resampled apart.
 *
 * Both intervals are null for fewer than 2 tasks. With 2 or 3 tasks the bootstrap interval is the range of the gaps
 * (the lowest and the highest mean are each drawn with a chance above 2.5%), and the t interval, with 1 or 2 degrees
 * of freedom, is wide, so neither says much. The t quantile is computed here (regularized incomplete beta and
 * bisection on the t CDF) instead of read from a table, so any df works.
 */
'use strict';

const BOOTSTRAP_RESAMPLES = 10000;
const BOOTSTRAP_SEED = 20260101;
/** The two-sided confidence level of both intervals. */
const CONFIDENCE = 0.95;
const UPPER_QUANTILE = 1 - (1 - CONFIDENCE) / 2;

// Lanczos approximation, g = 7, 9 coefficients: about 15 correct digits for positive arguments.
const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = Object.freeze([
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]);
const CONTINUED_FRACTION_STEPS = 300;
const CONTINUED_FRACTION_EPSILON = 1e-14;
const TINY = 1e-300;
const BISECTION_STEPS = 200;
// Far above the 0.975 quantile for df = 1 (12.706), the widest case.
const BISECTION_HIGH = 1000;

/** log Gamma(x) by the Lanczos approximation, for x of 0.5 or more (the t CDF with df of 1 or more needs no less). */
function logGamma(x) {
  const shifted = x - 1;
  let series = LANCZOS_COEFFICIENTS[0];
  const base = shifted + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i++)
    series += LANCZOS_COEFFICIENTS[i] / (shifted + i);
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(base) -
    base +
    Math.log(series)
  );
}

/** The continued fraction of the incomplete beta function, by the modified Lentz method. */
function betaContinuedFraction(x, a, b) {
  const clampAwayFromZero = (value) => (Math.abs(value) < TINY ? TINY : value);
  let numeratorTerm = 1;
  let denominatorTerm = 1 / clampAwayFromZero(1 - ((a + b) * x) / (a + 1));
  let result = denominatorTerm;
  for (let step = 1; step <= CONTINUED_FRACTION_STEPS; step++) {
    const twoStep = 2 * step;
    // The even term of the fraction.
    let coefficient =
      (step * (b - step) * x) / ((a + twoStep - 1) * (a + twoStep));
    denominatorTerm = 1 / clampAwayFromZero(1 + coefficient * denominatorTerm);
    numeratorTerm = clampAwayFromZero(1 + coefficient / numeratorTerm);
    result *= denominatorTerm * numeratorTerm;
    // The odd term of the fraction.
    coefficient =
      (-(a + step) * (a + b + step) * x) / ((a + twoStep) * (a + twoStep + 1));
    denominatorTerm = 1 / clampAwayFromZero(1 + coefficient * denominatorTerm);
    numeratorTerm = clampAwayFromZero(1 + coefficient / numeratorTerm);
    const change = denominatorTerm * numeratorTerm;
    result *= change;
    if (Math.abs(change - 1) < CONTINUED_FRACTION_EPSILON) break;
  }
  return result / a;
}

/** The regularized incomplete beta function I_x(a, b). */
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );
  // The fraction converges fast for x below (a + 1) / (a + b + 2); the symmetry I_x(a, b) = 1 - I_(1-x)(b, a) covers
  // the rest.
  return x < (a + 1) / (a + b + 2)
    ? front * betaContinuedFraction(x, a, b)
    : 1 - front * betaContinuedFraction(1 - x, b, a);
}

/** The CDF of Student's t distribution with `df` degrees of freedom (1 or more) at `t`. */
function tCdf(t, df) {
  if (!Number.isFinite(df) || df < 1)
    throw new TypeError('df must be a number of 1 or more');
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** The two-sided 95% critical value of the t distribution (its 0.975 quantile) for `df` of 1 or more, else null. */
function tCritical95(df) {
  if (!(df >= 1)) return null;
  let low = 0;
  let high = BISECTION_HIGH;
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const middle = (low + high) / 2;
    if (tCdf(middle, df) < UPPER_QUANTILE) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** A seeded generator of numbers in [0, 1) (mulberry32): the same seed gives the same sequence on every machine. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const calculateMean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Rounds to 4 decimal places; null and undefined stay null. */
const round4 = (value) =>
  value === null || value === undefined ? null : Number(value.toFixed(4));

/**
 * The mean of `gaps` with a 95% t interval (df = n - 1) and a 95% paired bootstrap interval. Plain numbers in and
 * out, not rounded. Returns { tasks, mean_gap, t_interval, bootstrap_interval }; the intervals are [low, high] or
 * null for fewer than 2 gaps, and mean_gap is null for none. Throws on a gap that is not a finite number, so a
 * missing rate cannot enter the mean as NaN.
 */
function gapStats(
  gaps,
  { resamples = BOOTSTRAP_RESAMPLES, seed = BOOTSTRAP_SEED } = {},
) {
  if (!Array.isArray(gaps)) throw new TypeError('gaps must be an array');
  const badIndex = gaps.findIndex(
    (gap) => typeof gap !== 'number' || !Number.isFinite(gap),
  );
  if (badIndex >= 0)
    throw new TypeError(`gaps[${badIndex}] must be a finite number`);
  if (!Number.isInteger(resamples) || resamples < 1)
    throw new TypeError('resamples must be a whole number, 1 or more');
  const count = gaps.length;
  if (!count)
    return {
      tasks: 0,
      mean_gap: null,
      t_interval: null,
      bootstrap_interval: null,
    };
  const meanGap = calculateMean(gaps);
  if (count < 2)
    return {
      tasks: count,
      mean_gap: meanGap,
      t_interval: null,
      bootstrap_interval: null,
    };
  const standardDeviation = Math.sqrt(
    gaps.reduce((sum, gap) => sum + (gap - meanGap) ** 2, 0) / (count - 1),
  );
  const halfWidth =
    tCritical95(count - 1) * (standardDeviation / Math.sqrt(count));
  const random = seededRandom(seed);
  const resampledMeans = new Float64Array(resamples);
  for (let resample = 0; resample < resamples; resample++) {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += gaps[Math.floor(random() * count)];
    resampledMeans[resample] = sum / count;
  }
  resampledMeans.sort();
  const lowTail = (1 - CONFIDENCE) / 2;
  return {
    tasks: count,
    mean_gap: meanGap,
    t_interval: [meanGap - halfWidth, meanGap + halfWidth],
    bootstrap_interval: [
      resampledMeans[Math.floor(lowTail * resamples)],
      resampledMeans[Math.ceil(UPPER_QUANTILE * resamples) - 1],
    ],
  };
}

module.exports = {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  CONFIDENCE,
  tCdf,
  tCritical95,
  seededRandom,
  gapStats,
  round4,
};
