// SPDX-License-Identifier: Apache-2.0
/**
 * The verdict for one skill under the decision rule `paired-t/v1` (see decision-rule.js).
 *
 * `gradedVerdict` turns pair records into `keep`, `prune` or `needs human review` from judge score
 * gaps alone. `wordCheckGate` can then turn a `keep` or `prune` into review when the cheap
 * word checks disagree with the judge. It never creates a `keep` or a `prune`, and word checks never
 * enter the judge gap. `unblind` maps the two scores a judge gave to the answers it saw as A and
 * B onto the with and without arm. All three functions are pure: no I/O, no model call.
 *
 * Pair record fields read here (aggregate.js builds them):
 *  - `loaded`: the skill took part in the with-arm run. Anything but `true` is a load failure.
 *  - `counted`: the pair describes the condition it claims (loaded, and for a control it also
 *    passed the treatment check). Anything but `true` is excluded.
 *  - `scored`: enough judge seats gave a valid score. Anything but `true` is unscored.
 *  - `mean_delta`: the pair's gap, the with score minus the without score, averaged over every
 *    judge call on the pair.
 *  - `w`: the pair's word-check gap, or null when it has none. Read by `wordCheckGate` only.
 * A missing field never counts in a pair's favour.
 */
const {
  KEEP_FLOOR,
  PRUNE_FLOOR,
  MIN_DECISION_PAIRS,
  MIN_SEATS_PER_PAIR,
  T_975,
  T_990,
  tCritical,
} = require('./decision-rule');

const REVIEW = 'needs human review';

/** A pair feeds the decision when it is counted, scored and has a finite gap. */
const isUsablePair = (pair) =>
  pair.counted === true && pair.scored === true && Number.isFinite(pair.mean_delta);

/**
 * Verdict on a skill from the judge gaps of its pairs.
 *
 *   keep   95% t interval entirely above +0.1, at least 8 usable pairs
 *   prune  99% one-sided t upper bound below -0.2, at least 8 usable pairs
 *   else   needs human review
 *
 * Pairs that do not feed the decision are of three kinds and are handled differently:
 *  - A pair whose with run never loaded the skill is a harness failure. It does not describe the
 *    condition it claims, so it blocks the verdict (review).
 *  - A pair that failed the treatment check is not a measurement of that treatment. It is dropped
 *    and the rest decide, with MIN_DECISION_PAIRS guarding against deciding on the few left.
 *  - A counted pair that too few judge seats scored is unscored, dropped the same way and named in
 *    the reason.
 * A pair marked scored whose gap is not a finite number is inconsistent data. It blocks the
 * verdict instead of being dropped, because dropping it would let the rest decide as if it had
 * never been planned.
 *
 * `pruneSafety.blocked_reason`, when set, turns a prune into review.
 */
function gradedVerdict(pairs, pruneSafety = { blocked_reason: null }) {
  const excluded = pairs.filter((p) => !p.counted).length;
  const loadFailed = pairs.filter((p) => p.loaded !== true).length;
  const treatmentFailed = pairs.filter((p) => p.loaded === true && p.counted !== true).length;
  const unscored = pairs.filter((p) => p.counted === true && p.scored !== true).length;
  const invalid = pairs.filter(
    (p) => p.counted === true && p.scored === true && !Number.isFinite(p.mean_delta),
  ).length;
  const means = pairs.filter(isUsablePair).map((p) => p.mean_delta);
  const n = means.length;
  const base = {
    pairs: n,
    mean: null,
    ci: null,
    excluded,
    load_failed: loadFailed,
    treatment_failed: treatmentFailed,
    unscored,
    invalid,
  };
  const unscoredNote = unscored
    ? `; ${unscored}/${pairs.length} pairs unscored ` +
      `(fewer than ${MIN_SEATS_PER_PAIR} judge seats gave a valid score)`
    : '';
  const decide = () => {
    if (loadFailed) {
      return {
        ...base,
        verdict: REVIEW,
        reason: `skill did not load in ${loadFailed}/${pairs.length} planned with runs`,
      };
    }
    if (invalid) {
      return {
        ...base,
        verdict: REVIEW,
        reason: `${invalid}/${pairs.length} pairs are marked scored but have no finite score gap`,
      };
    }
    if (n === 0) {
      return {
        ...base,
        verdict: REVIEW,
        reason: treatmentFailed
          ? `no pair took the directive (${treatmentFailed}/${pairs.length} failed the treatment check)`
          : 'no pair carried judge scores',
      };
    }
    const mean = means.reduce((a, b) => a + b, 0) / n;
    if (n < MIN_DECISION_PAIRS) {
      return {
        ...base,
        verdict: REVIEW,
        reason: treatmentFailed
          ? `only ${n} usable pairs, need at least ${MIN_DECISION_PAIRS} ` +
            `(${treatmentFailed}/${pairs.length} failed the treatment check)`
          : `only ${n} scored pairs, need at least ${MIN_DECISION_PAIRS}`,
        mean,
      };
    }
    const variance = means.reduce((acc, m) => acc + (m - mean) ** 2, 0) / (n - 1);
    const standardError = Math.sqrt(variance / n);
    const t95 = tCritical(n - 1, T_975);
    const t99 = tCritical(n - 1, T_990);
    const ci = [mean - t95 * standardError, mean + t95 * standardError];
    const pruneCi = [mean - t99 * standardError, mean + t99 * standardError];
    if (![mean, variance, standardError, ...ci, ...pruneCi].every(Number.isFinite)) {
      return {
        ...base,
        verdict: REVIEW,
        reason: 'the score gaps give a mean or interval that is not finite',
      };
    }
    const at = { ...base, mean, ci, prune_ci: pruneCi };
    const gap = `mean score gap ${mean.toFixed(2)}`;
    if (ci[0] > KEEP_FLOOR) {
      return { ...at, verdict: 'keep', reason: `${gap}, 95% lower bound above +${KEEP_FLOOR}` };
    }
    if (pruneCi[1] < PRUNE_FLOOR) {
      if (pruneSafety.blocked_reason) {
        return { ...at, verdict: REVIEW, reason: `prune is blocked: ${pruneSafety.blocked_reason}` };
      }
      return { ...at, verdict: 'prune', reason: `${gap}, 99% upper bound below ${PRUNE_FLOOR}` };
    }
    return {
      ...at,
      verdict: REVIEW,
      reason: `${gap}, interval does not clear +${KEEP_FLOOR} or ${PRUNE_FLOOR}`,
    };
  };
  const decision = decide();
  return { ...decision, reason: `${decision.reason}${unscoredNote}` };
}

const fmt = (x) => (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

/**
 * The word-check gate (identifier WORD_CHECK_GATE_ID in decision-rule.js).
 *
 * A pair's word-check gap `w` is the with arm's share of passed checks minus the without arm's.
 * Over the usable pairs that have a finite `w` (k of them), when k is at least MIN_DECISION_PAIRS:
 *  - a `keep` whose 95% interval of `w` lies entirely below 0 becomes review: the checks say the
 *    skill is worse;
 *  - a `prune` whose 95% interval of `w` lies entirely above 0 becomes review: the checks say the
 *    skill is better;
 *  - anything else is unchanged, and the gap is printed in the reason.
 * Below k = MIN_DECISION_PAIRS the gate is off and the reason says how many pairs have checks.
 * If the interval cannot be computed, a `keep` or `prune` becomes review, so the gate fails closed.
 *
 * Returns a copy of `verdict` with `judge_verdict` (the verdict before the gate), `word_check`
 * ({ gate: 'on' | 'off', pairs, need, mean, ci, vetoed }) and an updated `reason`. The `verdict`
 * field is either unchanged or review; this function never produces `keep` or `prune`.
 */
function wordCheckGate(verdict, pairs) {
  const gaps = pairs.filter((p) => isUsablePair(p) && Number.isFinite(p.w)).map((p) => p.w);
  const k = gaps.length;
  const judged = verdict.verdict;
  const decisive = judged === 'keep' || judged === 'prune';
  const wc = { gate: 'off', pairs: k, need: MIN_DECISION_PAIRS, mean: null, ci: null, vetoed: false };
  const out = (fields) => ({ ...verdict, judge_verdict: judged, ...fields });

  if (k < MIN_DECISION_PAIRS) {
    return out({
      word_check: wc,
      reason: `${verdict.reason}; word checks off: ${k} pairs with checks, need ${MIN_DECISION_PAIRS}`,
    });
  }

  const mean = gaps.reduce((a, b) => a + b, 0) / k;
  const variance = gaps.reduce((acc, g) => acc + (g - mean) ** 2, 0) / (k - 1);
  const standardError = Math.sqrt(variance / k);
  const t95 = tCritical(k - 1, T_975);
  const ci = [mean - t95 * standardError, mean + t95 * standardError];
  const on = { ...wc, gate: 'on' };

  if (![mean, variance, standardError, ...ci].every(Number.isFinite)) {
    if (!decisive) return out({ word_check: on });
    return out({
      verdict: REVIEW,
      word_check: { ...on, vetoed: true },
      reason: `word-check gap is not finite, so the judge verdict ${judged} cannot be confirmed`,
    });
  }

  const seen = `${fmt(mean)} (95% interval [${fmt(ci[0])}, ${fmt(ci[1])}] over ${k} pairs)`;
  const wordOn = { ...on, mean, ci };
  const veto = (direction) =>
    out({
      verdict: REVIEW,
      word_check: { ...wordOn, vetoed: true },
      reason:
        `word checks say the skill is ${direction}: word-check gap (with minus without) ${seen}; ` +
        `judge verdict was ${judged} (${verdict.reason})`,
    });
  if (judged === 'keep' && ci[1] < 0) return veto('worse');
  if (judged === 'prune' && ci[0] > 0) return veto('better');
  return out({
    word_check: wordOn,
    reason: `${verdict.reason}; word-check gap (with minus without) ${seen}`,
  });
}

/** The two presentation orders: which arm the judge saw as answer A. */
const ORDERS = Object.freeze(['with-first', 'without-first']);

/**
 * Un-blinds the scores of one judge call. `a` and `b` are the scores the judge gave to the
 * answers it saw as A and B. With `with-first`, A was the with arm; with `without-first`, A was
 * the without arm. Returns `{ with, without, delta }`, where `delta` is the with score minus the
 * without score, so a positive delta always favours the skill.
 *
 * An order other than the two presentation orders throws: guessing one would flip the sign of
 * every gap from that call. Scores that are not both finite numbers (a refused reply carries
 * null) give `{ with: null, without: null, delta: null }` and the caller decides what that means.
 */
function unblind(order, a, b) {
  if (!ORDERS.includes(order)) {
    throw new Error(
      `unknown presentation order ${JSON.stringify(String(order))}; use ${ORDERS.join(' or ')}`,
    );
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { with: null, without: null, delta: null };
  }
  const withScore = order === 'with-first' ? a : b;
  const withoutScore = order === 'with-first' ? b : a;
  return { with: withScore, without: withoutScore, delta: withScore - withoutScore };
}

module.exports = { REVIEW, ORDERS, isUsablePair, gradedVerdict, wordCheckGate, unblind };
