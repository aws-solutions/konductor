// SPDX-License-Identifier: Apache-2.0
'use strict';

// A study in which every run errored or ended in under a second measured nothing: the agent never ran, so the arms cannot differ.

const MIN_REAL_RUN_MS = 1000;

// Fake agents in CLI tests finish in milliseconds; BENCH_TEST_MODE is the same test-only switch the isolation gate uses.
const minRealRunMs = () => (process.env.BENCH_TEST_MODE === '1' ? 0 : MIN_REAL_RUN_MS);

/** null when at least one run looks like real work; otherwise { runs, errored, quick, reason }. Budget-skipped runs are ignored. */
function infraFailure(results, minMs = minRealRunMs()) {
  const ran = results.filter((r) => r.status !== 'budget_skipped');
  if (!ran.length) return null;
  const errored = ran.filter((r) => r.status === 'error' && !r.agentSelfKill).length;
  const selfKilled = ran.filter((r) => r.agentSelfKill).length;
  const quick = ran.filter((r) => r.status !== 'error' && Number.isFinite(r.wallClockMs) && r.wallClockMs < minMs).length;
  // An agent that killed its own runtime ran (D-243): that is a result, so it never counts toward an infra failure.
  if (selfKilled || errored + quick !== ran.length) return null;
  return { runs: ran.length, errored, quick, reason: `all ${ran.length} run(s) errored (${errored}) or finished in under ${minMs} ms (${quick}); treat the study as an infrastructure failure, not a result` };
}

// A plant control suite runs fake agents that finish in milliseconds by design, so the check is skipped for it and this reason is logged and written to summary.json.
const CONTROL_SUITE_SHORT_RUN_NOTE = 'control suite: short-run check skipped (fake controls finish in under a second by design)';

/**
 * The study's infra verdict as `{ infra, skipped }`. `plantSuite` is the prepared plant suite or null: only a suite with
 * `control: true` (a plant control suite, made by --kiro-bin) skips the check, with `skipped` holding the reason to log;
 * every other study, including a plant suite of the real Kiro CLI whether counted or not, gets `infraFailure` and `skipped: null`.
 */
function studyInfraCheck(results, plantSuite) {
  if (plantSuite?.control) return { infra: null, skipped: CONTROL_SUITE_SHORT_RUN_NOTE };
  return { infra: infraFailure(results), skipped: null };
}

module.exports = { infraFailure, studyInfraCheck, MIN_REAL_RUN_MS, CONTROL_SUITE_SHORT_RUN_NOTE };
