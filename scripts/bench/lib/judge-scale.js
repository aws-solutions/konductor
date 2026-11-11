// SPDX-License-Identifier: Apache-2.0
/**
 * Judge scales, reply parser and scoring. No model call and no file access: every function
 * here is pure.
 *
 * Two scales, one reply shape. Each answer is scored alone: a judge sees the request, a checklist and one answer, and
 * returns one label per checklist item: MET, PARTIAL or MISSING (weights 1, 0.5 and 0). It is never told which arm wrote
 * the answer, or that another answer exists. The scale says which checklist it was:
 *
 *   items    reading B. The rules checklist of the task. Every item has a bucket (value, format or guard) from the
 *            bucket sidecar. All buckets feed the score, the gap and the label. Guard items also feed the guard figure.
 *   outcome  reading A. The request-only checklist. It has no buckets.
 *
 * The score of an answer is 1 plus 4 times the share of weight met, so it runs from 1 to 5. A seat counts for a task when
 * both of its answers (the with and the without arm) got a valid judgment from that seat; the seat gap is score with
 * minus score without. A task's gap is the mean of its seat gaps, and a task counts only when at least 2 of its seats
 * count (the 12-of-16 coverage rule is the report's).
 *
 * The parser is strict because a lenient one would score a reply the prompt did not ask for. The whole reply must be one
 * JSON object with `items` (and optionally a string `reason`), holding exactly one upper-case label per checklist item,
 * in order. Prose around the JSON, two objects, a lower-case label, a missing or extra label, an unknown field and a
 * field given twice are all invalid, with a reason the judge job can store and a `kind` it can count. A reply that quotes an answer's fake
 * verdict next to its own fails here too, because it is no longer one object. One code fence that wraps the whole reply
 * (bare or tagged `json`) is the one leniency: it adds no text and no second object, models add it often even when told
 * not to, and a rejected reply is a paid call lost. Its body then goes through the same strict path, and the result says
 * `normalized: 'fence'` so the rate can be measured. A fence with prose around it, two fences or another language tag
 * stay invalid.
 *
 * The prompt version of each scale is here; its sha is in judge-prompt.js, next to the template file it hashes.
 */
'use strict';

const { BUCKETS } = require('./formats');
const { ARMS } = require('./layout');
const { SEAT_NAME } = require('./names');

const LABELS = Object.freeze(['MET', 'PARTIAL', 'MISSING']);
const WEIGHT = Object.freeze({ MET: 1, PARTIAL: 0.5, MISSING: 0 });
const SCORE_MIN = 1;
const SCORE_MAX = 5;
/** A task counts in a reading when this many seats judged both of its answers validly (2 of 3). */
const MIN_SEATS = 2;
const REPLY_FIELDS = Object.freeze(['items', 'reason']);

const SCALES = Object.freeze({
  items: Object.freeze({
    id: 'items',
    reading: 'B',
    promptVersion: 1,
    templateFile: 'judge-prompt.items.v1.md',
    bucketed: true,
  }),
  outcome: Object.freeze({
    id: 'outcome',
    reading: 'A',
    promptVersion: 1,
    templateFile: 'judge-prompt.outcome.v1.md',
    bucketed: false,
  }),
});

/** The scale descriptor for an id. Throws on any other id, so a retired scale name cannot reach a paid call. */
function resolveScale(id) {
  if (!Object.hasOwn(SCALES, id))
    throw new TypeError(
      `unknown judge scale "${id}"; use one of ${Object.keys(SCALES).join(', ')}`,
    );
  return SCALES[id];
}

const calculateMean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const isWholeNumber = (value) => Number.isInteger(value) && value >= 1;
const requireArm = (arm, description) => {
  if (!ARMS.includes(arm))
    throw new TypeError(`${description} must be one of ${ARMS.join(', ')}`);
};
/** Why a reply is invalid, as a machine code the ledger can count. */
const INVALID_KINDS = Object.freeze([
  'empty',
  'not_json',
  'not_object',
  'fields',
  'labels',
]);
const buildInvalidReply = (kind, reason) => ({
  valid: false,
  kind,
  invalid: reason,
});
// One fence around the whole trimmed reply: the opening line is ``` or ```json and nothing else, the closing line is ```.
const WHOLE_REPLY_FENCE = /^```(?:json)?[ \t]*\n([\s\S]*)\n[ \t]*```$/;

/**
 * The keys of the top-level object in `json`, in order and with repeats. `json` already parsed without an error, so
 * every string is closed. JSON.parse keeps only the last of two equal keys, so a repeat is found here instead.
 */
function topLevelKeys(json) {
  const keys = [];
  let depth = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (char === '"') {
      let end = i + 1;
      while (json[end] !== '"') end += json[end] === '\\' ? 2 : 1;
      if (depth === 1) {
        let next = end + 1;
        while (/\s/.test(json[next])) next++;
        if (json[next] === ':') keys.push(JSON.parse(json.slice(i, end + 1)));
      }
      i = end;
    } else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
  }
  return keys;
}

function findLabelProblem(labels, key, itemCount) {
  if (!Array.isArray(labels)) return `${key} must be an array of labels`;
  if (labels.length !== itemCount)
    return `${key} has ${labels.length} labels, expected ${itemCount}`;
  const badIndex = labels.findIndex(
    (label) => typeof label !== 'string' || !LABELS.includes(label),
  );
  return badIndex < 0
    ? null
    : `${key}[${badIndex}] is not one of ${LABELS.join(', ')}`;
}

/**
 * The reply of a judge as { valid: true, items, reason, normalized }, or { valid: false, kind, invalid: <why> }.
 * `itemCount` is the length of the checklist the judge was shown. `normalized` is 'fence' when one code fence around the
 * whole reply was removed, else null. `kind` is one of INVALID_KINDS.
 */
function parseReply(text, itemCount) {
  if (!isWholeNumber(itemCount))
    throw new TypeError('itemCount must be a whole number, 1 or more');
  if (typeof text !== 'string' || !text.trim())
    return buildInvalidReply('empty', 'the reply is empty');
  const trimmed = text.trim();
  const fence = WHOLE_REPLY_FENCE.exec(trimmed);
  const isFenced = Boolean(fence);
  const body = isFenced ? fence[1] : trimmed;
  let reply;
  try {
    reply = JSON.parse(body);
  } catch {
    return buildInvalidReply(
      'not_json',
      'the reply is not one JSON object (prose around it, a fence with more than the object, two objects or broken JSON)',
    );
  }
  if (reply === null || typeof reply !== 'object' || Array.isArray(reply))
    return buildInvalidReply('not_object', 'the reply is not a JSON object');
  const unexpectedFields = Object.keys(reply).filter(
    (field) => !REPLY_FIELDS.includes(field),
  );
  if (unexpectedFields.length)
    return buildInvalidReply(
      'fields',
      `unexpected field(s): ${unexpectedFields.join(', ')}`,
    );
  // Two "items" in one object would let the last array win, whatever the first one said.
  const keys = topLevelKeys(body);
  const repeated = [
    ...new Set(keys.filter((key, i) => keys.indexOf(key) !== i)),
  ];
  if (repeated.length)
    return buildInvalidReply(
      'fields',
      `repeated field(s): ${repeated.join(', ')}`,
    );
  const problem = findLabelProblem(reply.items, 'items', itemCount);
  if (problem) return buildInvalidReply('labels', problem);
  if (reply.reason !== undefined && typeof reply.reason !== 'string')
    return buildInvalidReply('fields', 'reason must be a string');
  return {
    valid: true,
    items: reply.items,
    reason: reply.reason ?? null,
    normalized: isFenced ? 'fence' : null,
  };
}

/** 1 to 5: 1 plus 4 times the share of weight met. */
const scoreOf = (labels) =>
  SCORE_MIN +
  (SCORE_MAX - SCORE_MIN) * calculateMean(labels.map((label) => WEIGHT[label]));

/** The bucket list is required for `items` (every item has one) and refused for `outcome` (it has none). */
function checkBuckets(scale, buckets, itemCount) {
  if (!scale.bucketed) {
    if (buckets !== null)
      throw new TypeError(`the ${scale.id} scale has no buckets`);
    return;
  }
  if (
    !Array.isArray(buckets) ||
    buckets.some((bucket) => !BUCKETS.includes(bucket))
  )
    throw new TypeError(
      `the ${scale.id} scale needs one bucket (${BUCKETS.join(', ')}) per checklist item`,
    );
  if (buckets.length !== itemCount)
    throw new TypeError(
      `${buckets.length} buckets for ${itemCount} checklist items`,
    );
}

/** Guard items only: how many there are and the weight the answer met on them. Null when the checklist has none. */
function computeGuard(labels, buckets) {
  const guardIndexes = (buckets || []).flatMap((bucket, i) =>
    bucket === 'guard' ? [i] : [],
  );
  if (!guardIndexes.length) return null;
  return {
    items: guardIndexes.length,
    met: guardIndexes.reduce((sum, i) => sum + WEIGHT[labels[i]], 0),
  };
}

/**
 * One judge reply about one answer, scored. `arm` is the arm of the answer the judge was shown (layout ARMS); the judge
 * was not told it. `buckets` has one entry per checklist item for `items` and is null for `outcome`; `itemCount` is then
 * the checklist length (it defaults to the number of buckets). Returns { valid: false, scale, arm, kind, invalid } or
 *   { valid: true, scale, arm, labels, score, guard, reason, normalized }
 * where `guard` is { items, met } (the guard weight this answer met) or null when the checklist has no guard item.
 */
function scoreJudgment({ scale, text, arm, itemCount, buckets = null }) {
  const scaleInfo = resolveScale(scale);
  requireArm(arm, 'arm');
  const checklistLength = itemCount ?? (buckets && buckets.length);
  if (!isWholeNumber(checklistLength))
    throw new TypeError('itemCount must be a whole number, 1 or more');
  checkBuckets(scaleInfo, buckets, checklistLength);
  const reply = parseReply(text, checklistLength);
  if (!reply.valid) return { scale: scaleInfo.id, arm, ...reply };
  return {
    valid: true,
    scale: scaleInfo.id,
    arm,
    labels: reply.items,
    score: scoreOf(reply.items),
    guard: computeGuard(reply.items, buckets),
    reason: reply.reason,
    normalized: reply.normalized,
  };
}

/**
 * The gap of one task in one reading, from the scored judgments of its seats ({ seat, ...scoreJudgment result }, one
 * per seat and arm). `scale` is required and every judgment must carry it: an `items` and an `outcome` judgment for the
 * same seat and arm would otherwise replace each other and mix two readings into one gap.
 * A seat counts when it has a valid judgment for both arms; its gap is score with minus score without. A seat with one
 * valid arm does not count. The task counts when at least `minSeats` seats count; its gap is the mean seat gap. A later
 * valid judgment for the same seat and arm replaces an earlier one, so a redo wins; an invalid one replaces nothing.
 * `guard` is { items, with_met, without_met }: the mean over counted seats of the guard weight met by each arm's own
 * judgment, or null when the checklist has no guard item. The counted judgments must agree on the guard: all null, or
 * all with the same number of guard items.
 */
function aggregateTask(judgments, { scale, minSeats = MIN_SEATS } = {}) {
  const scaleInfo = resolveScale(scale);
  if (!Array.isArray(judgments))
    throw new TypeError('judgments must be an array');
  if (!isWholeNumber(minSeats))
    throw new TypeError('minSeats must be a whole number, 1 or more');
  const seats = new Map();
  judgments.forEach((judgment, index) => {
    if (judgment === null || typeof judgment !== 'object')
      throw new TypeError(`judgments[${index}] must be an object`);
    if (judgment.scale !== scaleInfo.id)
      throw new TypeError(
        `judgments[${index}] is for scale "${judgment.scale}", not "${scaleInfo.id}"; aggregate one scale at a time`,
      );
    if (typeof judgment.valid !== 'boolean')
      throw new TypeError(`judgments[${index}].valid must be true or false`);
    if (!judgment.valid) return;
    if (typeof judgment.seat !== 'string' || !SEAT_NAME.test(judgment.seat))
      throw new TypeError(`judgments[${index}].seat must be a seat name`);
    requireArm(judgment.arm, `judgments[${index}].arm`);
    if (
      typeof judgment.score !== 'number' ||
      !(judgment.score >= SCORE_MIN && judgment.score <= SCORE_MAX)
    )
      throw new TypeError(
        `judgments[${index}].score must be a number from ${SCORE_MIN} to ${SCORE_MAX}`,
      );
    const { guard } = judgment;
    if (
      guard !== null &&
      guard !== undefined &&
      !(
        isWholeNumber(guard.items) &&
        typeof guard.met === 'number' &&
        guard.met >= 0 &&
        guard.met <= guard.items
      )
    )
      throw new TypeError(
        `judgments[${index}].guard must be null or { items: a whole number, met: 0 to items }`,
      );
    if (!seats.has(judgment.seat)) seats.set(judgment.seat, new Map());
    seats.get(judgment.seat).set(judgment.arm, judgment);
  });
  const counted = [...seats]
    .filter(([, byArm]) => ARMS.every((arm) => byArm.has(arm)))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (counted.length < minSeats)
    return {
      valid: false,
      gap: null,
      seat_gaps: {},
      seats_valid: counted.length,
      guard: null,
      invalid: `${counted.length} valid seat(s), need ${minSeats}`,
    };
  const seatGaps = Object.fromEntries(
    counted.map(([seat, byArm]) => [
      seat,
      byArm.get('with').score - byArm.get('without').score,
    ]),
  );
  const countedJudgments = counted.flatMap(([, byArm]) => [...byArm.values()]);
  const guardItemsOf = (judgment) =>
    judgment.guard === null || judgment.guard === undefined
      ? null
      : judgment.guard.items;
  const guardItems = guardItemsOf(countedJudgments[0]);
  if (
    countedJudgments.some((judgment) => guardItemsOf(judgment) !== guardItems)
  )
    throw new TypeError(
      'the counted judgments disagree on the guard: all must have none, or the same number of guard items',
    );
  const calculateGuardMean = (arm) =>
    calculateMean(counted.map(([, byArm]) => byArm.get(arm).guard.met));
  return {
    valid: true,
    gap: calculateMean(Object.values(seatGaps)),
    seat_gaps: seatGaps,
    seats_valid: counted.length,
    guard:
      guardItems === null
        ? null
        : {
            items: guardItems,
            with_met: calculateGuardMean('with'),
            without_met: calculateGuardMean('without'),
          },
    invalid: null,
  };
}

module.exports = {
  LABELS,
  WEIGHT,
  SCORE_MIN,
  SCORE_MAX,
  MIN_SEATS,
  SCALES,
  INVALID_KINDS,
  resolveScale,
  parseReply,
  scoreOf,
  scoreJudgment,
  aggregateTask,
};
