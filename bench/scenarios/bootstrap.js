// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pre-registered statistic (plan section 7): the mean paired difference (head minus base) per task, averaged over
// tasks, with a two-level bootstrap for its interval: draw tasks with replacement, then draw runs with replacement
// inside each drawn task and arm. The number of draws, the seed and the margin come from protocol.js. Pure: numbers in,
// numbers out, so a report and a test get the same result for the same data.
//
// Verdict words (plan 7): "beats by the margin" lower bound over +margin; "beats" lower bound over 0; "loses" upper bound
// under 0; "ties" interval inside -margin to +margin; otherwise "unsettled". The plan lists the words in that order. An
// interval can fit two (for example 1 to 3 is above 0 and inside +-5), and then the rule is symmetric: a sign that the
// interval settles (beats, loses) wins over "ties", so a small real gain and a small real loss are both named.
// A table of several rows (per phase, per role) uses Holm's step-down rule: the rows are ordered by p-value, row i of m
// is tested at alpha / (m - i), and its interval is taken at that level; once a row fails, every later row keeps that
// row's level.

const { mulberry32 } = require('../../tests/scripts/stats.js');
const { BOOTSTRAP, MARGIN } = require('./protocol.js');

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const finite = (xs) => (xs ?? []).filter((x) => typeof x === 'number' && Number.isFinite(x));

/** A task is usable when both arms have at least one score. Returns { tasks: [{ id, head, base }], dropped: [ids] }. */
function usableTasks(tasks) {
  const clean = tasks.map((t) => ({ id: t.id, head: finite(t.head), base: finite(t.base) }));
  return { tasks: clean.filter((t) => t.head.length && t.base.length), dropped: clean.filter((t) => !t.head.length || !t.base.length).map((t) => t.id) };
}

/** The point estimate: the mean over tasks of (mean head - mean base). */
const estimateOf = (tasks) => mean(tasks.map((t) => mean(t.head) - mean(t.base)));

/** `draws` bootstrap values of the estimate, sorted ascending. Tasks first, then runs inside each drawn task and arm. */
function bootstrapDraws(tasks, { draws = BOOTSTRAP.draws, seed = BOOTSTRAP.seed } = {}) {
  const n = tasks.length;
  const rng = mulberry32(seed);
  const out = new Float64Array(draws);
  const pick = (xs) => xs[Math.floor(rng() * xs.length)];
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const t = tasks[Math.floor(rng() * n)];
      let h = 0;
      for (let k = 0; k < t.head.length; k++) h += pick(t.head);
      let b = 0;
      for (let k = 0; k < t.base.length; k++) b += pick(t.base);
      sum += h / t.head.length - b / t.base.length;
    }
    out[d] = sum / n;
  }
  return out.sort();
}

/** The percentile interval at `confidence` of sorted draws. */
function intervalOf(sorted, confidence = BOOTSTRAP.confidence) {
  const alpha = 1 - confidence;
  const n = sorted.length;
  return { low: sorted[Math.max(0, Math.floor((alpha / 2) * n))], high: sorted[Math.min(n - 1, Math.ceil((1 - alpha / 2) * n) - 1)] };
}

/** Two-sided bootstrap p-value of "the difference is 0", with a +1 so it is never 0. */
function pValueOf(sorted) {
  const n = sorted.length;
  let below = 0;
  while (below < n && sorted[below] <= 0) below++;
  let above = 0;
  while (above < n && sorted[n - 1 - above] >= 0) above++;
  return Math.min(1, (2 * (Math.min(below, above) + 1)) / (n + 1));
}

/** The verdict word for an interval { low, high } (see the header for the order). */
function verdictWord({ low, high }, margin = MARGIN) {
  if (low === null || low === undefined || high === null || high === undefined) return 'unsettled';
  if (low > margin) return 'beats by the margin';
  if (low > 0) return 'beats';
  if (high < 0) return 'loses';
  if (low >= -margin && high <= margin) return 'ties';
  return 'unsettled';
}

const TOO_FEW = 'fewer than 2 tasks with scores in both arms: no interval';

/**
 * One comparison at the 95% level. `tasks` are { id, head: [scores], base: [scores] }.
 * Returns { n, dropped, estimate, low, high, verdict, note? }.
 */
function compare(tasks, opts = {}) {
  const margin = opts.margin ?? MARGIN;
  const u = usableTasks(tasks);
  if (u.tasks.length < 2) return { n: u.tasks.length, dropped: u.dropped, estimate: u.tasks.length ? estimateOf(u.tasks) : null, low: null, high: null, verdict: 'unsettled', note: TOO_FEW };
  const sorted = bootstrapDraws(u.tasks, opts);
  const { low, high } = intervalOf(sorted, opts.confidence ?? BOOTSTRAP.confidence);
  return { n: u.tasks.length, dropped: u.dropped, estimate: estimateOf(u.tasks), low, high, verdict: verdictWord({ low, high }, margin), draws: sorted.length };
}

/**
 * Several comparisons (the rows of a per-phase or per-role table) with Holm's correction.
 * `rows` are { key, tasks }. Returns the rows in input order with { n, estimate, p, pAdj, level, low, high, verdict }.
 * A row with fewer than 2 usable tasks is unsettled, has no interval, and does not count toward the correction.
 */
function compareRows(rows, opts = {}) {
  const margin = opts.margin ?? MARGIN;
  const alpha = 1 - (opts.confidence ?? BOOTSTRAP.confidence);
  const seed = opts.seed ?? BOOTSTRAP.seed;
  const prepared = rows.map((r, i) => {
    const u = usableTasks(r.tasks);
    if (u.tasks.length < 2) return { key: r.key, i, n: u.tasks.length, dropped: u.dropped, estimate: u.tasks.length ? estimateOf(u.tasks) : null, none: true };
    const sorted = bootstrapDraws(u.tasks, { draws: opts.draws, seed: seed + i });
    return { key: r.key, i, n: u.tasks.length, dropped: u.dropped, estimate: estimateOf(u.tasks), sorted, p: pValueOf(sorted) };
  });
  const live = prepared.filter((r) => !r.none).sort((a, b) => a.p - b.p || a.i - b.i);
  const m = live.length;
  let failedAt = m;
  let running = 0;
  live.forEach((r, i) => {
    running = Math.max(running, Math.min(1, (m - i) * r.p));
    r.pAdj = running;
    if (failedAt === m && r.p > alpha / (m - i)) failedAt = i;
    r.level = 1 - alpha / (m - Math.min(i, failedAt));
  });
  return prepared.map((r) => {
    if (r.none) return { key: r.key, n: r.n, dropped: r.dropped, estimate: r.estimate, p: null, pAdj: null, level: null, low: null, high: null, verdict: 'unsettled', note: TOO_FEW };
    const { low, high } = intervalOf(r.sorted, r.level);
    return { key: r.key, n: r.n, dropped: r.dropped, estimate: r.estimate, p: r.p, pAdj: r.pAdj, level: r.level, low, high, verdict: verdictWord({ low, high }, margin) };
  });
}

module.exports = { compare, compareRows, bootstrapDraws, intervalOf, pValueOf, verdictWord, usableTasks, estimateOf };
