// SPDX-License-Identifier: Apache-2.0
'use strict';

// Observed spend per judge call, read from profiles/judge-cost-observed.json. `judge --plan` uses it when the run
// directory has no earlier judging of its own.

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'profiles', 'judge-cost-observed.json');

/** The parsed data file, or null when it is missing or not in the shape this code reads. */
function loadObserved(file = FILE) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return d && d.schemaVersion === 1 && Array.isArray(d.entries) ? d : null;
  } catch { return null; }
}

/** The most specific entry for a call: (backend, judge, kind), then (backend, any judge, kind), then (backend, any, any). */
function lookup(data, backend, judge, kind) {
  const find = (j, k) => data.entries.find((e) => e.backend === backend && e.judge === j && e.kind === k);
  return find(judge, kind) ?? find('*', kind) ?? find('*', '*') ?? null;
}

/**
 * Low (mean) and high (p90) totals for `units` ([{ judge, kind, live }]) on `backend`. High is every call at its own p90, an
 * upper bound; it is null when an entry used has no p90. Returns null when the data has nothing for the backend.
 */
function estimateFromObserved(data, backend, units) {
  if (!data) return null;
  let low = 0;
  let high = 0;
  let spread = true;
  const used = new Set();
  for (const u of units) {
    if (!u.live) continue;
    const e = lookup(data, backend, u.judge, u.kind);
    if (!e) return null;
    used.add(e);
    low += e.mean * u.live;
    if (typeof e.p90 === 'number') high += e.p90 * u.live; else spread = false;
  }
  // A pooled entry already counts the calls of the judges it pools, so the figure is the larger of the two, not their sum.
  const entries = [...used];
  const exact = entries.filter((e) => e.judge !== '*').reduce((n, e) => n + e.liveCalls, 0);
  const observedCalls = Math.max(exact, ...entries.filter((e) => e.judge === '*').map((e) => e.liveCalls));
  return { low, high: spread ? high : null, measuredOn: data.measuredOn ?? null, observedCalls };
}

module.exports = { FILE, loadObserved, lookup, estimateFromObserved };
