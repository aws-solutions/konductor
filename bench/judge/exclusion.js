// SPDX-License-Identifier: Apache-2.0
'use strict';

// How a run kept out of judging counts in the rubric mean of a stamped study. 'integrity': the run broke a guard, so it
// counts as a failure (0 on every rubric item). 'gap': the run is not the agent's doing and is left out of the mean.
const EXCLUSION_CLASS = {
  credsUnscrubbed: 'integrity',
  stdioTampered: 'integrity',
  usageDbTampered: 'integrity',
  infraError: 'gap',
  'no workspace': 'gap',
};

// Written to judgments.json by judging code that applies the classes above. A file without it follows the older rule: excluded runs are gaps.
const RUBRIC_POLICY = 'excluded-as-failures';

/** 'integrity' | 'gap' for a notJudgedReason value; null for no reason or one this table does not know. */
const exclusionClassOfReason = (reason) => EXCLUSION_CLASS[reason] ?? null;

module.exports = { EXCLUSION_CLASS, RUBRIC_POLICY, exclusionClassOfReason };
