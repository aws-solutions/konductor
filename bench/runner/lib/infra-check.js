// SPDX-License-Identifier: Apache-2.0
'use strict';

// A study in which every run errored or ended in under a second measured nothing: the agent never ran, so the arms cannot differ.

const MIN_REAL_RUN_MS = 1000;

/** null when at least one run looks like real work; otherwise { runs, errored, quick, reason }. Budget-skipped runs are ignored. */
function infraFailure(results, minMs = MIN_REAL_RUN_MS) {
  const ran = results.filter((r) => r.status !== 'budget_skipped');
  if (!ran.length) return null;
  const errored = ran.filter((r) => r.status === 'error').length;
  const quick = ran.filter((r) => r.status !== 'error' && Number.isFinite(r.wallClockMs) && r.wallClockMs < minMs).length;
  if (errored + quick !== ran.length) return null;
  return { runs: ran.length, errored, quick, reason: `all ${ran.length} run(s) errored (${errored}) or finished in under ${minMs} ms (${quick}); treat the study as an infrastructure failure, not a result` };
}

module.exports = { infraFailure, MIN_REAL_RUN_MS };
