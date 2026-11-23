// SPDX-License-Identifier: Apache-2.0
'use strict';

// The A/A noise floor (FW-33): the same arm run twice, paired by task. Its interval half-width is the smallest gap a
// report may call more than noise; every gap printed beside it gets an inside or outside mark.

const { pairedCellCI } = require('./stats.js');

/**
 * The A/A noise of an arm against its repeat.
 * @param {{head:number[], base:number[]}[]} cells one per task: the arm's scores and its repeat's
 * @returns {{tasks:number, delta:number|null, halfWidth:number|null, sd:number|null}} halfWidth of the 95% paired t
 *   interval; sd of the per-task gap (what report/power.js takes); null below 2 paired tasks
 */
function aaNoise(cells) {
  const ci = pairedCellCI(cells);
  if (ci.se === null) return { tasks: ci.k, delta: ci.delta, halfWidth: null, sd: null };
  return { tasks: ci.k, delta: ci.delta, halfWidth: (ci.ciHigh - ci.ciLow) / 2, sd: ci.se * Math.sqrt(ci.k) };
}

/** Whether a gap sits inside the A/A half-width, in words for a report. */
function noiseMark(gap, aa) {
  if (!aa) return 'no A/A pair in these runs';
  if (aa.halfWidth === null) return 'A/A noise unknown (fewer than 2 paired tasks)';
  return `${Math.abs(gap) < aa.halfWidth ? 'inside' : 'outside'} A/A noise (half-width ${aa.halfWidth.toFixed(1)} over ${aa.tasks} tasks)`;
}

module.exports = { aaNoise, noiseMark };
