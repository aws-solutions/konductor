// SPDX-License-Identifier: Apache-2.0
'use strict';

const { VERDICT_VALUE } = require('./config.js');

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

module.exports = { rubricScore, pairOutcome, combineOrderings };
