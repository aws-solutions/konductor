#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The smallest mean gap a paired-by-task design can see (FW-34), so a verdict says "no gap over X", never "no gap".
//   node bench/report/power.js --sd SD --tasks N [--reps R] [--power 0.8]
// SD is the sample sd of the per-task gap (arm minus base, each a mean over R replicates). R does not enter the formula;
// it is printed because SD was measured at that replicate count and changes with it.

const { tQuantile } = require('./stats.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * (t[1 - alpha/2, n-1] + t[power, n-1]) x sd / sqrt(n).
 * @param {{sd:number, tasks:number, power?:number, alpha?:number}} o tasks is n, the paired units
 * @returns {number|null} points of the score; null with fewer than 2 tasks or no sd
 */
function detectableGap({ sd, tasks, power = 0.8, alpha = 0.05 }) {
  if (!fin(sd) || !(tasks >= 2)) return null;
  const df = tasks - 1;
  return ((tQuantile(1 - alpha / 2, df) + tQuantile(power, df)) * sd) / Math.sqrt(tasks);
}

const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

/**
 * The verdict words for a mean gap beside the design's detectable gap.
 * @param {{gap:number, detectable:number|null}} o
 * @returns {string}
 */
function gapWords({ gap, detectable }) {
  if (!fin(detectable)) return `gap ${signed(gap)} points; detectable gap unknown (fewer than 2 tasks or no spread)`;
  if (Math.abs(gap) < detectable) return `no gap over ${detectable.toFixed(1)} points (the design cannot see a smaller one)`;
  return `gap ${signed(gap)} points, over the detectable ${detectable.toFixed(1)}`;
}

/** One line for a report: the detectable gap and what it was computed from. */
function powerLine({ sd, tasks, reps = null, power = 0.8 }) {
  const d = detectableGap({ sd, tasks, power });
  const at = `${Math.round(power * 100)}% power`;
  if (d === null) return `detectable gap at ${at}: unknown (needs 2 or more tasks and an sd)`;
  return `detectable gap at ${at}: ${d.toFixed(1)} points (sd ${sd.toFixed(1)} of the per-task gap, ${tasks} tasks${reps ? `, ${reps} replicates per cell` : ''}, two-sided 5%)`;
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? Number(a[i + 1]) : undefined; };
  const sd = get('--sd'), tasks = get('--tasks'), reps = get('--reps'), power = get('--power') ?? 0.8;
  if (!fin(sd) || !Number.isInteger(tasks) || (reps !== undefined && !Number.isInteger(reps)) || !(power > 0 && power < 1)) {
    process.stderr.write('usage: node power.js --sd SD --tasks N [--reps R] [--power 0.8]\n');
    process.exit(64);
  }
  process.stdout.write(`${powerLine({ sd, tasks, reps, power })}\n`);
}

module.exports = { detectableGap, gapWords, powerLine };
