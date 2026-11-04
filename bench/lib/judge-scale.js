// SPDX-License-Identifier: Apache-2.0
/**
 * Judge scales: the pairing of a prompt template with the reply shape it asks for and the scoring
 * that reads that reply. A scale is chosen per run and the default is `overall`.
 *
 *   overall  one 1-5 quality score per answer plus a stated winner (judging/judge-prompt.v2.md).
 *            The judge forms a single impression of each answer.
 *   items    one MET / PARTIAL / MISSING label per checklist item per answer, and no stated
 *            winner (judging/judge-prompt.items.v1.md). The winner is derived from the labels,
 *            and the 1-5 score is derived from the share of items met, so both scales land on one
 *            yardstick and the keep and prune thresholds keep their meaning.
 *
 * The two scales are not interchangeable inside one cohort. A scale change gives a judgment a
 * different prompt version and prompt sha, so a stored judgment made with another scale is stale.
 *
 * `SCALES[id].parse(reply, options)` is pure and returns the same shape for every scale:
 *   { winner: 'A'|'B'|'TIE'|null, score_a: number|null, score_b: number|null,
 *     reason: string|null, problem: string|null }
 * The items scale adds `items_a` and `items_b`, the normalized labels. A `winner` of null means
 * the reply was unusable and `problem` says why. A reply on the overall scale is unusable unless
 * all of these hold:
 *  - the winner is A, B or TIE;
 *  - both scores are integers from 1 to 5;
 *  - the winner does not contradict the scores (`winnerScoreConflict`): A is refused when
 *    score_a < score_b, B when score_b < score_a, and a TIE when the gap is above TIE_MAX_GAP. A
 *    winner with equal scores is accepted: the judge preferred one answer without scoring it
 *    higher, and that pair adds a score gap of 0.
 * A reply that names a winner but gives no scores is unusable, not a vote without a margin.
 *
 * Un-blinding a score to the with and without arm is `unblind` in verdict.js.
 */

const SCORE_MIN = 1;
const SCORE_MAX = 5;
/** The largest score gap a stated TIE may have on the overall scale. */
const TIE_MAX_GAP = 1;
const ITEM_WEIGHT = Object.freeze({ MET: 1, PARTIAL: 0.5, MISSING: 0 });
/**
 * Below this, two item totals count as the same. 0.5 is one PARTIAL step, so only a real
 * difference wins.
 */
const ITEM_TIE_EPSILON = 0.25;

const winnerOf = (v) => {
  const w = String(v || '').toUpperCase();
  return ['A', 'B', 'TIE'].includes(w) ? w : null;
};
const reasonOf = (v) => (typeof v === 'string' ? v : '');

const unusable = (problem) => ({
  winner: null,
  score_a: null,
  score_b: null,
  reason: null,
  problem,
});

/** True for an integer from SCORE_MIN to SCORE_MAX. */
const isIntegerScore = (v) => Number.isInteger(v) && v >= SCORE_MIN && v <= SCORE_MAX;

/** Why the stated winner and the two valid scores disagree, or null when they agree. */
function winnerScoreConflict(winner, a, b) {
  if (winner === 'A' && a < b) {
    return `winner A contradicts the scores: score_a ${a} is below score_b ${b}`;
  }
  if (winner === 'B' && b < a) {
    return `winner B contradicts the scores: score_b ${b} is below score_a ${a}`;
  }
  if (winner === 'TIE' && Math.abs(a - b) > TIE_MAX_GAP) {
    return `a TIE needs scores at most ${TIE_MAX_GAP} apart, got ${a} and ${b}`;
  }
  return null;
}

function parseOverall(p) {
  const winner = winnerOf(p && p.winner);
  if (!winner) return unusable('winner is not A, B or TIE');
  const a = p.score_a;
  const b = p.score_b;
  if (!isIntegerScore(a) || !isIntegerScore(b)) {
    return unusable(`both scores must be integers from ${SCORE_MIN} to ${SCORE_MAX}`);
  }
  const conflict = winnerScoreConflict(winner, a, b);
  if (conflict) return unusable(conflict);
  return { winner, score_a: a, score_b: b, reason: reasonOf(p.reason), problem: null };
}

/**
 * The labels of one answer as weights, or null when the array is not one usable label per item.
 * `expectedLength` is the checklist length when the task is at hand (judging) and null when it is
 * not (reading a stored reply back); without it the two arrays only have to agree with each other.
 */
function itemWeights(labels, expectedLength) {
  if (!Array.isArray(labels) || labels.length === 0) return null;
  if (expectedLength !== null && expectedLength !== undefined && labels.length !== expectedLength) {
    return null;
  }
  const weights = labels.map((l) => ITEM_WEIGHT[String(l || '').trim().toUpperCase()]);
  return weights.every((w) => typeof w === 'number') ? weights : null;
}

/** Share of items met, 0-1, mapped onto the 1-5 score the overall scale uses. */
const scoreFromWeights = (weights) =>
  SCORE_MIN + (SCORE_MAX - SCORE_MIN) * (weights.reduce((a, b) => a + b, 0) / weights.length);

function parseItems(p, { rubricLength = null } = {}) {
  const a = itemWeights(p && p.items_a, rubricLength);
  const b = itemWeights(p && p.items_b, rubricLength);
  if (!a || !b || a.length !== b.length) {
    return unusable('items_a and items_b must be one MET, PARTIAL or MISSING label per item');
  }
  const totalA = a.reduce((x, y) => x + y, 0);
  const totalB = b.reduce((x, y) => x + y, 0);
  const diff = totalA - totalB;
  const normalize = (labels) => labels.map((l) => String(l).trim().toUpperCase());
  return {
    winner: Math.abs(diff) < ITEM_TIE_EPSILON ? 'TIE' : diff > 0 ? 'A' : 'B',
    score_a: scoreFromWeights(a),
    score_b: scoreFromWeights(b),
    reason: reasonOf(p && p.reason),
    problem: null,
    items_a: normalize(p.items_a),
    items_b: normalize(p.items_b),
  };
}

const SCALES = Object.freeze({
  overall: Object.freeze({
    id: 'overall',
    promptVersion: 2,
    templateFile: 'judge-prompt.v2.md',
    parse: parseOverall,
  }),
  items: Object.freeze({
    id: 'items',
    promptVersion: 1,
    templateFile: 'judge-prompt.items.v1.md',
    parse: parseItems,
  }),
});

const DEFAULT_SCALE = 'overall';

/** The scale descriptor for an id. Throws on an unknown id so a typo cannot reach a paid call. */
function resolveScale(id = DEFAULT_SCALE) {
  const key = id === undefined || id === null || id === '' ? DEFAULT_SCALE : String(id);
  if (!Object.hasOwn(SCALES, key)) {
    throw new Error(`unknown judge scale "${key}"; use one of ${Object.keys(SCALES).join(', ')}`);
  }
  return SCALES[key];
}

module.exports = {
  SCALES,
  DEFAULT_SCALE,
  TIE_MAX_GAP,
  resolveScale,
  parseOverall,
  parseItems,
  itemWeights,
  scoreFromWeights,
  winnerScoreConflict,
};
