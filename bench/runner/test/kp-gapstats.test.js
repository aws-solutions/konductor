// SPDX-License-Identifier: Apache-2.0
// Copied from Michael Lin's tests/scripts/bench/gap-stats.test.js (pull request #263, commit 33b385f9), same repository and Apache-2.0 licence: the gap statistics tests, unchanged apart from the require path.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const stats = require('../../cap/gapstats.js');

const assertNear = (actual, expected, tolerance = 1e-3) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
test('tCritical95 matches the published two-sided 95% table for df 1 to 30, 40, 60, 80, 100 and 120, and is null below df 1', () => {
  const table = [
    [1, 12.7062],
    [2, 4.3027],
    [3, 3.1824],
    [4, 2.7764],
    [5, 2.5706],
    [6, 2.4469],
    [7, 2.3646],
    [8, 2.306],
    [9, 2.2622],
    [10, 2.2281],
    [11, 2.201],
    [12, 2.1788],
    [13, 2.1604],
    [14, 2.1448],
    [15, 2.1314],
    [16, 2.1199],
    [17, 2.1098],
    [18, 2.1009],
    [19, 2.093],
    [20, 2.086],
    [21, 2.0796],
    [22, 2.0739],
    [23, 2.0687],
    [24, 2.0639],
    [25, 2.0595],
    [26, 2.0555],
    [27, 2.0518],
    [28, 2.0484],
    [29, 2.0452],
    [30, 2.0423],
    [40, 2.0211],
    [60, 2.0003],
    [80, 1.9901],
    [100, 1.984],
    [120, 1.9799],
  ];
  for (const [df, expected] of table)
    assertNear(stats.tCritical95(df), expected, 1e-4);
  assert.equal(stats.tCritical95(0), null);
  assert.equal(stats.tCritical95(0.5), null);
  assert.equal(stats.tCritical95(Number.NaN), null);
});

test('tCdf is a CDF: 0.5 at 0, symmetric, rising, and near 0.975 at the critical value', () => {
  assertNear(stats.tCdf(0, 4), 0.5, 1e-12);
  assertNear(stats.tCdf(1.3, 6) + stats.tCdf(-1.3, 6), 1, 1e-12);
  assert.ok(stats.tCdf(1, 3) < stats.tCdf(2, 3));
  assertNear(stats.tCdf(stats.tCritical95(9), 9), 0.975, 1e-9);
  // df = 1 is the Cauchy distribution: CDF(1) = 0.75 exactly.
  assertNear(stats.tCdf(1, 1), 0.75, 1e-9);
});

test('tCdf refuses a df below 1 or not a number, so it cannot return NaN quietly', () => {
  for (const df of [0, 0.5, -3, Number.NaN, Infinity, '4', undefined])
    assert.throws(() => stats.tCdf(1, df), /df must be a number of 1 or more/);
});

test('gapStats: mean, t interval from df = n - 1, and a bootstrap interval inside the data range', () => {
  const gaps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const result = stats.gapStats(gaps);
  // mean 0.45, sd 0.244949, se 0.086603, t(7) = 2.3646: half-width 0.20478.
  assert.equal(result.tasks, 8);
  assertNear(result.mean_gap, 0.45, 1e-9);
  assertNear(result.t_interval[0], 0.45 - 0.20478, 2e-4);
  assertNear(result.t_interval[1], 0.45 + 0.20478, 2e-4);
  const [low, high] = result.bootstrap_interval;
  assert.ok(low >= 0.1 && high <= 0.8 && low < 0.45 && high > 0.45);
  // A mean of 8 draws from this set has a sd near 0.0866, so the 95% bootstrap interval is near 0.45 +/- 0.17.
  assertNear(low, 0.28, 0.03);
  assertNear(high, 0.62, 0.03);
});

test('gapStats: the same seed gives the same interval, another seed resamples differently', () => {
  const gaps = [0.05, 0.4, 0.45, 0.9, 0.1, 0.33, 0.71, 0.2];
  assert.deepEqual(stats.gapStats(gaps), stats.gapStats(gaps));
  assert.notDeepEqual(
    stats.gapStats(gaps, { seed: 1 }).bootstrap_interval,
    stats.gapStats(gaps).bootstrap_interval,
  );
  assert.equal(stats.BOOTSTRAP_RESAMPLES, 10000);
  assert.equal(stats.BOOTSTRAP_SEED, 20260101);
});

test('gapStats: a constant gap has no spread, one gap has no interval, no gap has no mean', () => {
  assert.deepEqual(
    stats.gapStats([0.25, 0.25, 0.25]).bootstrap_interval,
    [0.25, 0.25],
  );
  assert.deepEqual(stats.gapStats([0.25, 0.25, 0.25]).t_interval, [0.25, 0.25]);
  assert.deepEqual(stats.gapStats([0.4]), {
    tasks: 1,
    mean_gap: 0.4,
    t_interval: null,
    bootstrap_interval: null,
  });
  assert.deepEqual(stats.gapStats([]), {
    tasks: 0,
    mean_gap: null,
    t_interval: null,
    bootstrap_interval: null,
  });
});

test('gapStats refuses a gap that is not a finite number, so a missing rate cannot become NaN', () => {
  assert.throws(
    () => stats.gapStats([0.1, null]),
    /gaps\[1\] must be a finite number/,
  );
  assert.throws(() => stats.gapStats([Number.NaN]), /gaps\[0\]/);
  assert.throws(() => stats.gapStats([Infinity, 0]), /gaps\[0\]/);
  assert.throws(() => stats.gapStats('0.1'), /gaps must be an array/);
  assert.throws(
    () => stats.gapStats([0.1, 0.2], { resamples: 0 }),
    /resamples must be a whole number/,
  );
});

test('the bootstrap percentiles are the 2.5th and 97.5th of the resampled means', () => {
  // With 200 resamples the low end is index floor(0.025 * 200) = 5 and the high end index ceil(0.975 * 200) - 1 = 194
  // of the sorted means. These 12 gaps give resampled means with no tie next to either pick, so a pick one place off
  // gives another number. Rebuild the means from the same seeded generator and check both picks.
  const gaps = [
    0.03, 0.11, 0.17, 0.24, 0.29, 0.38, 0.41, 0.52, 0.57, 0.66, 0.73, 0.88,
  ];
  const resamples = 200;
  const random = stats.seededRandom(stats.BOOTSTRAP_SEED);
  const means = [];
  for (let resample = 0; resample < resamples; resample++) {
    let sum = 0;
    for (let i = 0; i < gaps.length; i++)
      sum += gaps[Math.floor(random() * gaps.length)];
    means.push(sum / gaps.length);
  }
  means.sort((a, b) => a - b);
  for (const pick of [5, 194])
    assert.ok(
      means[pick] - means[pick - 1] > 1e-6 &&
        means[pick + 1] - means[pick] > 1e-6,
      `the mean at index ${pick} has no tie beside it`,
    );
  assert.deepEqual(stats.gapStats(gaps, { resamples }).bootstrap_interval, [
    means[5],
    means[194],
  ]);
});

test('the bootstrap interval of 12 distinct gaps at the full 10000 resamples is pinned', () => {
  const gaps = [
    0.03, 0.11, 0.17, 0.24, 0.29, 0.38, 0.41, 0.52, 0.57, 0.66, 0.73, 0.88,
  ];
  const result = stats.gapStats(gaps);
  assertNear(result.bootstrap_interval[0], 0.2741666666666666, 1e-12);
  assertNear(result.bootstrap_interval[1], 0.5616666666666666, 1e-12);
  assertNear(result.t_interval[0], 0.24890330561075702, 1e-9);
  assertNear(result.t_interval[1], 0.5827633610559096, 1e-9);
});

test('seededRandom (mulberry32) gives these first numbers for the report seed and for seed 1', () => {
  // Pinned to full precision: a change to the generator changes every published bootstrap interval.
  const report = stats.seededRandom(stats.BOOTSTRAP_SEED);
  assert.deepEqual(
    [report(), report(), report()],
    [0.2559139896184206, 0.5929048631805927, 0.8053383126389235],
  );
  const one = stats.seededRandom(1);
  assert.deepEqual(
    [one(), one(), one()],
    [0.6270739405881613, 0.002735721180215478, 0.5274470399599522],
  );
});

test('seededRandom is deterministic and stays in [0, 1)', () => {
  const first = stats.seededRandom(7);
  const second = stats.seededRandom(7);
  for (let i = 0; i < 1000; i++) {
    const value = first();
    assert.equal(value, second());
    assert.ok(value >= 0 && value < 1);
  }
});

test('round4 rounds to 4 places and keeps null', () => {
  assert.equal(stats.round4(0.123456), 0.1235);
  assert.equal(stats.round4(-0.00004), -0);
  assert.equal(stats.round4(null), null);
  assert.equal(stats.round4(undefined), null);
});
