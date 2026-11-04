// SPDX-License-Identifier: Apache-2.0
/**
 * Pair records and the skill result.
 *
 * `aggregateSkill` builds one pair record per task from stored judge score gaps, applies
 * `gradedVerdict` to the judge gaps, then applies `wordCheckGate` using each pair's word-check
 * gap. Word checks never enter a pair's judge gap (`mean_delta`). It is pure: no I/O, no model
 * call.
 *
 * Where word-check results come from. The caller passes `wordChecks`, and the judge driver
 * (run/judge.js) builds it from the `check_results` stored on each arm's pair (store.js). Whoever
 * writes a pair fills `check_results` with `checkResultsFor` (checks.js), which runs the task's
 * checks on the arm's final snapshot; nothing in this file runs a check.
 */
const { MIN_SEATS_PER_PAIR, DECISION_RULE_NAME, decisionRuleSha256 } = require('./decision-rule');
const { gradedVerdict, wordCheckGate } = require('./verdict');

/** How a planned judge seat took part in a pair, and how a pair did as a whole. */
const STATUS = Object.freeze({ SCORED: 'scored', UNSCORED: 'unscored', INVALID: 'invalid' });

/** How many seats of a pair delivered a numeric score gap. */
const seatsScored = (bySeatOrder) =>
  Object.values(bySeatOrder || {}).filter((byOrder) =>
    Object.values(byOrder || {}).some((d) => Number.isFinite(d)),
  ).length;

/**
 * The status of each seat of one pair: `scored` when it gave at least one finite gap; otherwise
 * `invalid` when one of its replies was refused or it carried a gap that is not a finite number;
 * otherwise `unscored` (no judgment yet, or one that gave no score). The seats are the planned
 * `cfg.judges` plus any other seat that has refusals or gaps, so a seat that took part is never
 * left out.
 *
 * `refusedBySeatOrder` is `{ [seat]: { [order]: truthy } }`, true where that reply was refused.
 * `deltasBySeatOrder` is `{ [seat]: { [order]: number | null } }`.
 */
function seatStatuses(cfg, refusedBySeatOrder, deltasBySeatOrder) {
  const seats = new Set([
    ...cfg.judges.map((j) => j.seat),
    ...Object.keys(refusedBySeatOrder || {}),
    ...Object.keys(deltasBySeatOrder || {}),
  ]);
  const out = {};
  for (const seat of seats) {
    const deltas = Object.values((deltasBySeatOrder || {})[seat] || {});
    const refused = Object.values((refusedBySeatOrder || {})[seat] || {});
    if (deltas.some(Number.isFinite)) out[seat] = STATUS.SCORED;
    else if (refused.some(Boolean) || deltas.some((d) => d !== null && d !== undefined)) {
      out[seat] = STATUS.INVALID;
    } else out[seat] = STATUS.UNSCORED;
  }
  return out;
}

const countStatus = (statuses) => {
  const n = { scored: 0, unscored: 0, invalid: 0 };
  for (const s of Object.values(statuses)) n[s] += 1;
  return n;
};

/**
 * Flattens one pair's per-seat, per-order score gaps into `{ score_deltas, mean_delta }`.
 * `mean_delta` averages every finite gap the judges reported for that pair, so a pair contributes
 * one number however many judge calls it took. Null when no judge reported a usable score.
 */
function deltasFor(bySeatOrder) {
  const flat = [];
  for (const byOrder of Object.values(bySeatOrder || {})) {
    for (const d of Object.values(byOrder || {})) if (Number.isFinite(d)) flat.push(d);
  }
  return {
    score_deltas: flat,
    mean_delta: flat.length ? flat.reduce((a, b) => a + b, 0) / flat.length : null,
  };
}

/**
 * The share of word checks one arm passed on its final workspace: passed over counted. `results`
 * has one entry per check: true (passed), false (failed) or null (no verdict). Null when the task
 * has no checks, when any check gave no verdict, or when `results` is not an array. A share built
 * from only some of a task's checks would not compare across the two arms.
 */
function checkShare(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  if (!results.every((r) => r === true || r === false)) return null;
  return results.filter((r) => r === true).length / results.length;
}

/** How many word checks `results` holds; a missing or non-array value holds none. */
const checkCount = (results) => (Array.isArray(results) ? results.length : 0);

/**
 * Aggregates one skill.
 *
 *  - `taskSet`: `{ tasks: [{ id, target_section }], prune_blocked_reason? }`. Ids must be unique.
 *  - `deltas`: `{ [taskId]: { [seat]: { [order]: with score minus without score } } }`, already
 *    un-blinded. A task with no entry is unscored.
 *  - `refused`: `{ [taskId]: { [seat]: { [order]: truthy } } }`, where a judge reply was refused.
 *  - `loaded`: `{ [taskId]: boolean }`, from the with-arm event log. A missing entry is not loaded.
 *  - `treatment`: optional `{ [taskId]: { required, adhered } }`. Where `required`, the pair counts
 *    only if `adhered`. Only a control skill has one.
 *  - `wordChecks`: optional `{ [taskId]: { with: results, without: results } }`, each `results`
 *    as in `checkShare`. A missing entry or arm gives no word-check gap for the pair. Both arms of
 *    a task must hold the same number of results (a missing arm counts as none). When they differ
 *    the pair has no word-check gap (`c_with`, `c_without` and `w` are null), stays in the judge
 *    gap, and carries `check_mismatch: { with, without }` with the two lengths; the skill result
 *    then carries `check_mismatch_pairs`, their count. The aggregation does not throw on it,
 *    because a stored run must still replay.
 *  - `cfg`: `{ judges: [{ seat }] }`, the planned seats.
 *
 * A pair is scored when at least MIN_SEATS_PER_PAIR of the planned seats (fewer if fewer were
 * planned) gave a valid score. Each pair record carries `c_with`, `c_without` and
 * `w = c_with - c_without`, each null when absent. The result has `graded` (the judge verdict
 * alone) and `verdict` (after the word-check gate). `verdict.judge_verdict` repeats the judge-only
 * verdict, and `verdict.word_check` holds `k` (usable pairs with a word-check gap), the gap's mean
 * and 95% interval, `vetoed`, and `off_reason` (why there is no gap; see wordCheckGate).
 */
function aggregateSkill({
  skill,
  taskSet,
  deltas = {},
  refused = {},
  loaded = {},
  treatment = {},
  wordChecks = {},
  cfg,
}) {
  if (!taskSet || !Array.isArray(taskSet.tasks)) {
    throw new Error('aggregateSkill: taskSet.tasks must be an array');
  }
  const seen = new Set();
  for (const t of taskSet.tasks) {
    if (typeof t.id !== 'string' || t.id === '') throw new Error('aggregateSkill: a task has no id');
    if (seen.has(t.id)) throw new Error(`aggregateSkill: duplicate task id ${t.id}`);
    seen.add(t.id);
  }
  const pruneBlockedReason = taskSet.prune_blocked_reason || null;
  const planned = cfg.judges.length;
  const minSeats = Math.min(MIN_SEATS_PER_PAIR, planned);
  const pairs = taskSet.tasks.map((t) => {
    const bySeatOrder = deltas[t.id];
    const pairDeltas = deltasFor(bySeatOrder);
    const judgesScored = seatsScored(bySeatOrder);
    const judgeStatus = seatStatuses(cfg, refused[t.id], bySeatOrder);
    const seatCounts = countStatus(judgeStatus);
    const scored = judgesScored >= minSeats && Number.isFinite(pairDeltas.mean_delta);
    const check = treatment[t.id] || null;
    const adhered = !check || !check.required || !!check.adhered;
    const words = wordChecks[t.id] || {};
    // The two arms of one task must have run the same list of checks. Unequal lists (an arm re-run
    // after the checks were edited, or one arm missing its results) give shares that do not compare,
    // so the pair is left out of the word-check gap and says so.
    const withLength = checkCount(words.with);
    const withoutLength = checkCount(words.without);
    const mismatched = withLength !== withoutLength;
    const cWith = mismatched ? null : checkShare(words.with);
    const cWithout = mismatched ? null : checkShare(words.without);
    return {
      task_id: t.id,
      target_section: t.target_section,
      loaded: loaded[t.id] === true,
      adhered,
      counted: loaded[t.id] === true && adhered,
      judges_scored: judgesScored,
      judges_planned: planned,
      judge_status: judgeStatus,
      judges_unscored: seatCounts.unscored,
      judges_invalid: seatCounts.invalid,
      scored,
      status: scored ? STATUS.SCORED : seatCounts.invalid > 0 ? STATUS.INVALID : STATUS.UNSCORED,
      ...(check && check.required ? { treatment: check } : {}),
      ...pairDeltas,
      c_with: cWith,
      c_without: cWithout,
      w: cWith !== null && cWithout !== null ? cWith - cWithout : null,
      ...(mismatched ? { check_mismatch: { with: withLength, without: withoutLength } } : {}),
    };
  });
  const mismatchedPairs = pairs.filter((p) => p.check_mismatch !== undefined).length;
  const prune_safety = { blocked_reason: pruneBlockedReason };
  const graded = gradedVerdict(pairs, prune_safety);
  const verdict = wordCheckGate(graded, pairs);
  // Every planned pair and every judge seat of it appears once: pair_status sums to pairs.length
  // and judge_participation to the number of seat slots in those pairs.
  const pairStatus = { scored: 0, unscored: 0, invalid: 0 };
  const participation = { scored: 0, unscored: 0, invalid: 0 };
  for (const p of pairs) {
    pairStatus[p.status] += 1;
    for (const [k, v] of Object.entries(countStatus(p.judge_status))) participation[k] += v;
  }
  return {
    skill,
    decision_rule: DECISION_RULE_NAME,
    rule_sha256: decisionRuleSha256(),
    pairs,
    pair_status: pairStatus,
    judge_participation: participation,
    unscored: graded.unscored,
    prune_safety,
    graded,
    verdict,
    ...(mismatchedPairs > 0 ? { check_mismatch_pairs: mismatchedPairs } : {}),
  };
}

module.exports = {
  STATUS,
  seatsScored,
  seatStatuses,
  countStatus,
  deltasFor,
  checkShare,
  aggregateSkill,
};
