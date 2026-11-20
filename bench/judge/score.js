// SPDX-License-Identifier: Apache-2.0
'use strict';

const { VERDICT_VALUE, MIN_PANEL_FAMILIES } = require('./config.js');
const { EXPERT_PREFIX } = require('../runner/lib/expert-rubric.js');

// SR-24: a run's panel score is the median over judges from at least this many distinct families other than the agent's.
const MIN_JUDGES = MIN_PANEL_FAMILIES;

/**
 * The panel score of one run from its judges' scores `scores` (one per judge; non-numbers are skipped): the median, or
 * null (NO DATA) when fewer than MIN_JUDGES judges scored it. With an even count the median is the mean of the middle two.
 */
function panelScore(scores) {
  const xs = scores.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < MIN_JUDGES) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// A verdict whose evidence quote is not found in the output drops one level.
const DOWNGRADE = { pass: 'partial', partial: 'fail', fail: 'fail' };

// An expert-key criterion (runner/lib/expert-rubric.js) counts only with a quote (D-62), so without one it fails;
// any other criterion drops one level.
const unquotedVerdict = (id, verdict) => (String(id).startsWith(EXPERT_PREFIX) ? 'fail' : DOWNGRADE[verdict]);

// Weighted sum of pass=1, partial=0.5, fail=0, divided by the total weight.
function rubricScore(rubric, criteria) {
  const verdicts = new Map(criteria.map((c) => [c.id, c.verdict]));
  let got = 0;
  let total = 0;
  for (const r of rubric) {
    total += r.weight;
    got += r.weight * (VERDICT_VALUE[verdicts.get(r.id)] ?? 0);
  }
  return total ? got / total : null;
}

// `winner` is the judge's pick by position; `armIsA` says where the arm sat.
function pairOutcome(winner, armIsA) {
  if (winner === 'tie') return 'tie';
  return (winner === 'A') === armIsA ? 'win' : 'loss';
}

// Any disagreement between the two orderings is a tie, flagged as position-driven.
function combineOrderings(first, second) {
  if (first == null || second == null) return { verdict: null, positionInconsistent: false };
  if (first === second) return { verdict: first, positionInconsistent: false };
  return { verdict: 'tie', positionInconsistent: true };
}

/**
 * Two graded orderings, each { armGrade, baseGrade } or null, into the mean grades, the mean difference (arm minus
 * baseline) and whether the preference flipped with position (one order favored the arm, the other the baseline).
 * `shift` is the mean absolute change in the grade of the same answer between the two orders.
 */
function combineGraded(first, second) {
  if (!first || !second) return { armGrade: null, baseGrade: null, delta: null, orderDisagreement: false, shift: null };
  const d1 = first.armGrade - first.baseGrade;
  const d2 = second.armGrade - second.baseGrade;
  return {
    armGrade: (first.armGrade + second.armGrade) / 2,
    baseGrade: (first.baseGrade + second.baseGrade) / 2,
    delta: (d1 + d2) / 2,
    orderDisagreement: (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0),
    shift: (Math.abs(first.armGrade - second.armGrade) + Math.abs(first.baseGrade - second.baseGrade)) / 2,
  };
}

module.exports = { DOWNGRADE, unquotedVerdict, MIN_JUDGES, panelScore, rubricScore, pairOutcome, combineOrderings, combineGraded };
