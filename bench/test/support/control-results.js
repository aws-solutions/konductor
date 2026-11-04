// SPDX-License-Identifier: Apache-2.0
/**
 * Skill results made by the real aggregation from chosen score gaps, for tests of the control
 * gate. Nothing here is a real run.
 */
const { aggregateSkill } = require('../../lib/aggregate');
const { roster } = require('./roster');

/** Ten gaps whose mean is about +2: the with arm wins clearly. */
const WITH_WINS = Object.freeze([2.33, 2, 2, 1.67, 2.33, 2, 1.67, 2.67, 2.33, 2]);
/** Ten gaps whose mean is about -2: the without arm wins clearly. */
const WITHOUT_WINS = Object.freeze(WITH_WINS.map((g) => -g));
/** Ten gaps centred on zero: no difference. */
const NO_DIFFERENCE = Object.freeze([0.33, -0.33, 0, 0.67, -0.67, 0, 0.33, -0.33, 0, 0]);

/**
 * The `aggregateSkill` result of a skill whose task i has the gap `gaps[i]` on every judge call.
 * `options.loaded(i)` says whether task i's with run loaded the skill; `options.treatment` is the
 * optional `treatment` input of `aggregateSkill`; `options.wordChecks(i)` returns
 * `{ with, without }` check results for task i, or undefined for a task with no checks.
 */
function aggregateOf(skill, gaps, { loaded = () => true, treatment, wordChecks = () => undefined } = {}) {
  const taskSet = { tasks: gaps.map((_, i) => ({ id: `t${i + 1}`, target_section: 'Section' })) };
  const cfg = { judges: roster(3) };
  const deltas = {};
  const loadedMap = {};
  const checks = {};
  gaps.forEach((gap, i) => {
    const id = `t${i + 1}`;
    deltas[id] = Object.fromEntries(
      cfg.judges.map((j) => [j.seat, { 'with-first': gap, 'without-first': gap }]),
    );
    loadedMap[id] = loaded(i);
    const words = wordChecks(i);
    if (words) checks[id] = words;
  });
  return aggregateSkill({
    skill,
    taskSet,
    deltas,
    loaded: loadedMap,
    treatment,
    wordChecks: checks,
    cfg,
  });
}

module.exports = { WITH_WINS, WITHOUT_WINS, NO_DIFFERENCE, aggregateOf };
