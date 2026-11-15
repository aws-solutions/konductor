// SPDX-License-Identifier: Apache-2.0
'use strict';

// How a run kept out of judging counts in the rubric mean of a stamped study. 'integrity': the run broke a guard, so it
// counts as a failure (0 on every rubric item). 'gap': the run is not the agent's doing and is left out of the mean.
// This file is the one place to move a reason or a scrub cause between the two classes.
const BY_CAUSE = 'by-cause';
const EXCLUSION_CLASS = {
  credsUnscrubbed: BY_CAUSE,
  stdioTampered: 'integrity',
  usageDbTampered: 'integrity',
  infraError: 'gap',
  'no workspace': 'gap',
};

// credsUnscrubbed has several causes (the `reason` of each unscrubbedFiles entry, see runner/lib/hygiene.js). Only a cause that
// shows the output was changed under the harness counts against the agent: a link or special file where a plain one was
// listed, or a file whose read access was taken away. A file the scrub could not rewrite, a secret-like run longer than the
// scrub window, an I/O error or an unknown cause is not evidence of misbehavior, so it is a gap. The run stays out of judging
// either way, because its text may still hold a secret.
const SCRUB_CAUSE_CLASS = {
  link: 'integrity',
  unreadable: 'integrity',
  unwritable: 'gap',
  'too-large': 'gap',
  error: 'gap',
};
const UNKNOWN_CAUSE = 'error';
const TAMPER_FLAGS = ['stdioTampered', 'usageDbTampered'];

// Written to judgments.json by judging code that applies the classes above. A file without it follows the older rule: excluded runs are gaps.
const RUBRIC_POLICY = 'excluded-as-failures';

/**
 * The scrub causes of a run's unscrubbedFiles. An entry from before reasons were classes, or a flagged run with no entries,
 * has the unknown cause.
 */
function scrubCausesOf(result) {
  const entries = Array.isArray(result?.unscrubbedFiles) ? result.unscrubbedFiles : [];
  const causes = entries.map((u) => (Object.hasOwn(SCRUB_CAUSE_CLASS, u?.reason) ? u.reason : UNKNOWN_CAUSE));
  return [...new Set(causes.length ? causes : [UNKNOWN_CAUSE])].sort();
}

/** 'integrity' | 'gap' for a notJudgedReason value and the run's result; null for no reason or one this table does not know. */
function exclusionClassOfRun(reason, result) {
  if (!reason) return null;
  const flags = result?.flags || [];
  const tampered = TAMPER_FLAGS.some((f) => flags.includes(f));
  const base = EXCLUSION_CLASS[reason];
  if (base === undefined) return null;
  if (base !== BY_CAUSE) return base;
  return tampered || scrubCausesOf(result).some((c) => SCRUB_CAUSE_CLASS[c] === 'integrity') ? 'integrity' : 'gap';
}

/** Same as exclusionClassOfRun without a result: a credsUnscrubbed run is taken to have the unknown cause. */
const exclusionClassOfReason = (reason) => exclusionClassOfRun(reason, null);

/** The reason as a stamped report shows it: a by-cause reason carries the causes of the run, e.g. `credsUnscrubbed [unwritable]`. */
const reasonLabel = (reason, result) => (EXCLUSION_CLASS[reason] === BY_CAUSE ? `${reason} [${scrubCausesOf(result).join(', ')}]` : reason);

/** [reason, class] rows of the policy table, one per scrub cause for a by-cause reason. */
const exclusionTable = () => Object.entries(EXCLUSION_CLASS).flatMap(([reason, cls]) => (
  cls === BY_CAUSE ? Object.entries(SCRUB_CAUSE_CLASS).map(([cause, c]) => [`${reason} [${cause}]`, c]) : [[reason, cls]]
));

module.exports = { EXCLUSION_CLASS, SCRUB_CAUSE_CLASS, RUBRIC_POLICY, BY_CAUSE, scrubCausesOf, exclusionClassOfRun, exclusionClassOfReason, reasonLabel, exclusionTable };
