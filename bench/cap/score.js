// SPDX-License-Identifier: Apache-2.0
'use strict';

// Trigger scoring over queries: precision, recall and F1 with Wilson intervals, the confusion list, and the
// agreement between the proxy and live modes on a cross-check sample.

const { cohenKappa, percentAgreement } = require('../judge/agreement.js');
const { DEFAULTS } = require('../judge/config.js');

const Z95 = 1.959964;
const MIN_CROSSCHECK = 12;

/** Wilson score interval for k successes in n trials. Null when n is 0. */
function wilson(k, n, z = Z95) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 0 || k > n) throw new Error('k must be between 0 and n');
  if (n === 0) return null;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  // Rounded so k = 0 gives exactly 0 and k = n exactly 1 instead of a float residue.
  return { lo: Math.max(0, +(center - half).toFixed(12)), hi: Math.min(1, +(center + half).toFixed(12)) };
}

function ratio(k, n) {
  const w = wilson(k, n);
  return { value: n === 0 ? null : k / n, lo: w ? w.lo : null, hi: w ? w.hi : null, n };
}

const bump = (obj, key, by = 1) => { obj[key] = (obj[key] || 0) + by; };

/**
 * rows: [{ queryId, expect: 'load'|'none', hit, fired?: [capability names that fired instead], rep? }]. `hit` means the
 * capability under test fired. A query is predicted positive when it fired in at least half of its repeats.
 * F1 is 2TP / (2TP + FP + FN), a proportion, so its interval is the Wilson interval of that ratio (approximate).
 */
function scoreTrigger(rows) {
  const byQuery = new Map();
  for (const r of rows) {
    if (r.expect !== 'load' && r.expect !== 'none') throw new Error('expect must be load or none');
    const q = byQuery.get(r.queryId) ?? { queryId: r.queryId, expect: r.expect, reps: 0, hits: 0, fired: {}, nearMissOf: r.nearMissOf };
    q.reps++;
    if (r.hit) q.hits++;
    for (const f of r.fired ?? []) bump(q.fired, f);
    byQuery.set(r.queryId, q);
  }
  const queries = [...byQuery.values()].map((q) => {
    const predicted = q.hits * 2 >= q.reps;
    return { ...q, rate: q.hits / q.reps, predicted, pass: q.expect === 'load' ? predicted : !predicted };
  });
  let tp = 0; let fp = 0; let fn = 0; let tn = 0;
  for (const q of queries) {
    if (q.expect === 'load') { if (q.predicted) tp++; else fn++; } else if (q.predicted) fp++; else tn++;
  }
  const confusion = [];
  const confusionCounts = {};
  for (const q of queries) {
    const wrong = q.expect === 'load' ? !q.predicted : q.predicted;
    if (!wrong || !Object.keys(q.fired).length) continue;
    confusion.push({ queryId: q.queryId, expect: q.expect, fired: q.fired });
    for (const [name, n] of Object.entries(q.fired)) bump(confusionCounts, name, n);
  }
  return { queries, tp, fp, fn, tn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), f1: ratio(2 * tp, 2 * tp + fp + fn), confusion, confusionCounts };
}

/**
 * pairs: [{ queryId, proxy: boolean, live: boolean }]. The proxy is trusted for a harness only at Cohen's kappa of at
 * least `kappaMin` on at least MIN_CROSSCHECK queries; every other outcome is labelled "proxy not validated".
 */
function crossCheck(pairs, { kappaMin = DEFAULTS.thresholds.kappaMin, minN = MIN_CROSSCHECK } = {}) {
  const labels = pairs.map((p) => [p.proxy ? 'fired' : 'quiet', p.live ? 'fired' : 'quiet']);
  const n = labels.length;
  const agreement = percentAgreement(labels);
  const kappa = cohenKappa(labels);
  let validated = false;
  let label;
  if (n < minN) label = `proxy not validated (n=${n}, need at least ${minN})`;
  else if (kappa === null) label = 'proxy not validated (kappa undefined: the sample has no variation)';
  else if (kappa < kappaMin) label = `proxy not validated (kappa ${kappa.toFixed(2)} < ${kappaMin})`;
  else { validated = true; label = `proxy validated (kappa ${kappa.toFixed(2)}, agreement ${Math.round(agreement * 100)}%, n=${n})`; }
  return { n, agreement, kappa, validated, label };
}

module.exports = { wilson, scoreTrigger, crossCheck, MIN_CROSSCHECK };
