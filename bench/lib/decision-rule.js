// SPDX-License-Identifier: Apache-2.0
/**
 * The decision rule `paired-t/v1`: the numbers and the digest that identify it.
 *
 * PROVISIONAL. The thresholds below (+0.1, -0.2, 8 pairs, the 95% and 99% levels) come from a
 * small early run and have not been calibrated on this suite. Every report that quotes a verdict
 * must say so. A `prune` is a candidate for human approval, never an action.
 *
 * The rule, on one skill (see verdict.js for the code):
 *  - The unit is the pair: one task, run with and without the skill. All judge scores on a pair are
 *    averaged into one gap first, so several judge calls on one task are never several samples.
 *  - `keep`:  the 95% two-sided t interval of the mean gap lies entirely above KEEP_FLOOR, with at
 *    least MIN_DECISION_PAIRS usable pairs.
 *  - `prune`: the 99% one-sided t upper bound of the mean gap lies below PRUNE_FLOOR, with at least
 *    MIN_DECISION_PAIRS usable pairs. Prune sits further from zero than keep on purpose: a wrong
 *    prune removes content, a wrong keep only costs context.
 *  - Otherwise: needs human review.
 *  - A word-check gate (WORD_CHECK_GATE_ID) can turn a `keep` or `prune` into review. It never
 *    creates one.
 *
 * Degrees of freedom are pair counts minus one. A table lookup clamps at the table ends: below 1
 * the 1 df value stands, above 30 the 30 df value stands, which is the conservative side.
 *
 * Changing a number or a table entry changes `decisionRuleSha256()` by itself. Changing the logic
 * does not, so bump DECISION_RULE_VERSION on any change to how a result is computed.
 *
 * The digest also covers the control treatment specs (treatment-check.js), because they decide
 * which control pairs count. Computing it reads the spec directory, so editing a spec makes every
 * stored result stale and they re-aggregate from stored judgments.
 */
const { sha256 } = require('./provenance');
const { specSha256 } = require('./treatment-check');

/** Name of this rule, recorded with every result. */
const DECISION_RULE_NAME = 'paired-t/v1';

/**
 * Bump on any change to how a result is computed: verdict.js, the pair gap in aggregate.js, or the
 * word-check gate. It is part of the digest, so a bump makes every stored result stale.
 */
const DECISION_RULE_VERSION = 1;

/** Identifier of the word-check gate rule (verdict.js `wordCheckGate`), covered by the digest. */
const WORD_CHECK_GATE_ID = 'word-check-veto/v1';

const KEEP_FLOOR = 0.1;
const PRUNE_FLOOR = -0.2;

/** Usable pairs needed before any keep or prune, and before the word-check gate is evaluated. */
const MIN_DECISION_PAIRS = 8;

/**
 * A pair is scored when at least this many of its planned judge seats gave a valid score. One
 * seat's opinion is not a panel.
 */
const MIN_SEATS_PER_PAIR = 2;

// Student t critical values for df = 1..30. T_975 is the two-sided 95% (97.5% one-sided) level used
// for keep and for the word-check gate. T_990 is the one-sided 99% level used for prune.
const T_975 = Object.freeze([
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
]);
const T_990 = Object.freeze([
  31.821, 6.965, 4.541, 3.747, 3.365, 3.143, 2.998, 2.896, 2.821, 2.764, 2.718, 2.681, 2.65, 2.624,
  2.602, 2.583, 2.567, 2.552, 2.539, 2.528, 2.518, 2.508, 2.5, 2.492, 2.485, 2.479, 2.473, 2.467,
  2.462, 2.457,
]);

/** The critical value of `level` (T_975 or T_990) at `df`, clamped to the table ends. */
const tCritical = (df, level) =>
  level[Math.min(Math.max(df, 1), level.length) - 1] || level[level.length - 1];

/**
 * Everything the digest covers: the rule's name and version, the word-check gate's identifier,
 * every threshold, both tables and the digest of the treatment specs. `options.treatmentDir`
 * names another spec directory, for a tool that checks specs before they are installed.
 */
const decisionRuleFields = (options = {}) => ({
  decision_rule_name: DECISION_RULE_NAME,
  decision_rule_version: DECISION_RULE_VERSION,
  word_check_gate: WORD_CHECK_GATE_ID,
  KEEP_FLOOR,
  PRUNE_FLOOR,
  MIN_DECISION_PAIRS,
  MIN_SEATS_PER_PAIR,
  T_975,
  T_990,
  treatment_specs: specSha256(options.treatmentDir),
});

/** Digest of a set of rule fields, as returned by `decisionRuleFields()`. */
const digestRuleFields = (fields) => sha256(fields);

/** Digest of the rule as it is in this file and the treatment specs as they are on disk. */
const decisionRuleSha256 = (options) => digestRuleFields(decisionRuleFields(options));

module.exports = {
  DECISION_RULE_NAME,
  DECISION_RULE_VERSION,
  WORD_CHECK_GATE_ID,
  KEEP_FLOOR,
  PRUNE_FLOOR,
  MIN_DECISION_PAIRS,
  MIN_SEATS_PER_PAIR,
  T_975,
  T_990,
  tCritical,
  decisionRuleFields,
  digestRuleFields,
  decisionRuleSha256,
};
