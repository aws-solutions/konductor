// SPDX-License-Identifier: Apache-2.0
'use strict';

// The code-only score of one dry-run pass, with the report's own scoring (report/scores.js): the hidden-test share
// (weight 0.5) and the weighted share of the other non-format checks (0.2), renormalised, as a run with no judge is
// scored. The rubric share needs judges and is left out.

const { checksScore, qualityOfRun } = require('../../report/scores.js');

const WEIGHTS = { hidden: 0.5, checks: 0.2, rubric: 0.3 };

/** { score 0..100 or null, hidden 0..1 or null, checks 0..1 or null } of a list of check results. */
function codeScore(results) {
  const tests = results.filter((r) => r.type === 'tests' && r.tests);
  const total = tests.reduce((n, r) => n + r.tests.total, 0);
  const hidden = tests.length ? (total > 0 ? tests.reduce((n, r) => n + r.tests.passed, 0) / total : 0) : null;
  const checks = checksScore(results, WEIGHTS);
  const q = qualityOfRun({ hidden, checks }, WEIGHTS);
  return { score: q ? q.score : null, hidden, checks };
}

const round1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

module.exports = { codeScore, round1, WEIGHTS };
