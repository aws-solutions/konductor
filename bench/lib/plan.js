// SPDX-License-Identifier: Apache-2.0
/**
 * The job plan of a run: which subject runs and which judge calls a task set needs. It is pure and
 * deterministic: no I/O, no clock, no random seed. A resumed run plans the same jobs, so work
 * already stored is found again.
 *
 * `planJobs({ [skill]: taskSet }, config)` returns `{ subject, judge }`:
 *   subject  one job per task and arm: `{ skill, task, arm }` with arm `with` or `without`
 *   judge    one job per task, seat and presentation order: `{ skill, task, judge, order }`
 * `taskSet` is `{ tasks: [{ id, ... }] }` and `config` the judge settings (judge-roster.js
 * `validateJudgeConfig`): the roster `judges`, `judgeOrders` and `ordersPerPair`. The roster comes
 * from the user's config. There are no noise jobs: an arm repeated against itself is the null
 * control's job, not a part of every plan.
 *
 * Orders. When a seat judges a pair in every order (`ordersPerPair` equal to the number of orders)
 * each pair is judged once per order. With fewer, a pair is judged in one order per seat and the
 * orders alternate down the jobs of one skill and seat, so each order is used `floor(k / n)` or
 * `ceil(k / n)` times for k jobs and n orders. A hash of the task id would balance only on
 * average, and a skill with five tasks could land all five in one order. A hash of the skill and
 * the seat rotates where the alternation starts, so the seats do not all begin with the same
 * order. Position bias then cancels across pairs, at half the calls. The per-seat order
 * consistency check is not measurable with one order per pair.
 */
const crypto = require('node:crypto');

const { ORDERS } = require('./verdict');
const { ARMS } = require('./provenance');
const { validateJudgeConfig } = require('./judge-roster');

/**
 * The presentation orders one judge job is judged in. `position` is the job's index among the
 * jobs of that skill and seat, counted from 0 (planJobs numbers them); it is only read when the
 * seat judges a pair in fewer orders than there are.
 */
function ordersFor(config, { skill = '', seat, position }) {
  const orders = config.judgeOrders || ORDERS;
  if ((config.ordersPerPair ?? orders.length) >= orders.length) return [...orders];
  if (!Number.isInteger(position) || position < 0) {
    throw new Error(
      'ordersFor: one order per pair needs the non-negative integer position of the job among its seat',
    );
  }
  const start = crypto.createHash('sha256').update(`${skill}\u0000${seat}`).digest()[0] % orders.length;
  return [orders[(position + start) % orders.length]];
}

/** Subject and judge job lists for task sets: `{ [skill]: taskSet }`. */
function planJobs(taskSetsBySkill, config) {
  const settings = validateJudgeConfig(config);
  const subject = [];
  const judge = [];
  for (const [skill, taskSet] of Object.entries(taskSetsBySkill)) {
    if (!taskSet || !Array.isArray(taskSet.tasks)) {
      throw new Error(`planJobs: ${skill} has no tasks array`);
    }
    const planned = {}; // judge jobs planned so far per seat, for the balanced order assignment
    const ids = new Set();
    for (const task of taskSet.tasks) {
      if (ids.has(task.id)) throw new Error(`planJobs: ${skill} has two tasks with the id ${task.id}`);
      ids.add(task.id);
      for (const arm of ARMS) subject.push({ skill, task, arm });
      for (const seat of settings.judges) {
        const position = (planned[seat.seat] = (planned[seat.seat] ?? -1) + 1);
        for (const order of ordersFor(settings, { skill, seat: seat.seat, position })) {
          judge.push({ skill, task, judge: seat, order });
        }
      }
    }
  }
  return { subject, judge };
}

module.exports = { ordersFor, planJobs };
