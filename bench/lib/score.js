// SPDX-License-Identifier: Apache-2.0
/**
 * From stored judgments to the inputs of `aggregateSkill`: read each judgment's reply text again,
 * un-blind its scores to the with and without arm, and sort the calls into scored, refused and
 * missing. It is pure, so a result can be rebuilt from stored judgments with no model call.
 *
 * The reply is read from the stored `raw_text` every time (judge-reply.js), not taken from the
 * `parsed` field the driver stored beside it. Then a change to how replies are read applies to a
 * stored run on its next scoring, and a hand-edited `parsed` cannot move a verdict.
 *
 * How one call counts, by the status of its stored judgment:
 *  - `ok`, or `unparsable` with text: the text is read. A usable reply gives a score gap (with
 *    minus without). An unusable one is refused, which makes that seat `invalid` in the pair.
 *  - `refused` or `invalid`: refused, so the seat is `invalid`.
 *  - `transient`, or no judgment: missing, so the seat is `unscored`.
 */
const { parseReply } = require('./judge-reply');
const { JUDGMENT_STATUS } = require('./store');
const { unblind } = require('./verdict');

/**
 * What one stored judgment says. Returns `{ kind: 'scored', delta, score_with, score_without }`,
 * `{ kind: 'refused', problem }` or `{ kind: 'missing' }`. `record` is null for no judgment.
 */
function judgmentOutcome(record, scaleId, { rubricLength = null } = {}) {
  if (!record) return { kind: 'missing' };
  const { OK, UNPARSABLE, REFUSED, INVALID } = JUDGMENT_STATUS;
  if (record.status === REFUSED || record.status === INVALID) {
    return { kind: 'refused', problem: `the grader returned ${record.status}` };
  }
  if (record.status !== OK && record.status !== UNPARSABLE) return { kind: 'missing' };
  const parsed = parseReply(scaleId, record.raw_text, { rubricLength });
  if (parsed.winner === null) return { kind: 'refused', problem: parsed.problem };
  const seen = unblind(record.order, parsed.score_a, parsed.score_b);
  if (seen.delta === null) return { kind: 'refused', problem: 'the reply has no finite scores' };
  return { kind: 'scored', delta: seen.delta, score_with: seen.with, score_without: seen.without };
}

/**
 * Sorts judgments into the `deltas` and `refused` maps `aggregateSkill` takes. `entries` is
 * `[{ taskId, seat, order, record, rubricLength }]`, one per planned call, with `record` null when
 * there is no settled judgment. A missing call leaves no entry, so its seat reads as unscored.
 */
function collectOutcomes(entries, scaleId) {
  const deltas = {};
  const refused = {};
  const put = (map, { taskId, seat, order }, value) => {
    map[taskId] = map[taskId] || {};
    map[taskId][seat] = map[taskId][seat] || {};
    map[taskId][seat][order] = value;
  };
  for (const entry of entries) {
    const outcome = judgmentOutcome(entry.record, scaleId, { rubricLength: entry.rubricLength });
    if (outcome.kind === 'scored') put(deltas, entry, outcome.delta);
    else if (outcome.kind === 'refused') {
      put(deltas, entry, null);
      put(refused, entry, true);
    }
  }
  return { deltas, refused };
}

module.exports = { judgmentOutcome, collectOutcomes };
