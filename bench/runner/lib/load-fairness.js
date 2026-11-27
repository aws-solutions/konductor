// SPDX-License-Identifier: Apache-2.0
'use strict';

// The load check's fairness rules (prompt-fix spec Part B; bench/scenarios/load-fairness.json holds the data, its
// date and its reason). They change what a task's load check counts as needed, never the task itself:
//   metByAgent    a unit (an SOP konductor does not declare) is met by a spawn of the agent that declares it
//   stackSkills   a stack skill stays needed only on the listed tasks, whose fixtures use that stack
//   needsAgent    a task left out of reports unless a run started in that agent (bench/report/exclude.js)
// Only loadCheckOf applies them; --forced-must-load still names the task's own mustLoad list.

const RULES = require('../../scenarios/load-fairness.json');

/** The units task `id` needs after the rules, in order, without repeats. */
function fairMustLoad(id, mustLoad) {
  const out = [];
  for (const u of mustLoad) {
    const keep = RULES.stackSkills[u];
    if (keep && !keep.includes(id)) continue;
    const unit = RULES.metByAgent[u] ?? u;
    if (!out.includes(unit)) out.push(unit);
  }
  return out;
}

module.exports = { RULES, fairMustLoad };
