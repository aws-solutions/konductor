// SPDX-License-Identifier: Apache-2.0
/**
 * Job planning: the subject runs and the judge calls that assembled tasks (tasks.js) ask for.
 *
 *   subject  one run per task and arm (with, without)
 *   judge    per task, per seat and per arm: one call for reading B (`items`, the rules checklist) when the batch is
 *            read by B, and one for reading A (`outcome`, the request-only checklist) when the task is not excluded
 *            from A
 *
 * This is the same count `plan` makes. No same-arm (noise) sample is taken, so there is no `with2` arm.
 *
 * Each answer is scored on its own: a judge call sees one arm's answer and never the other, so there is no order in
 * which two answers are shown and nothing to balance.
 */
'use strict';

const { seatsOf } = require('./config');
const { exclusionsFor } = require('./baseline');
const { ARMS } = require('./layout');

/**
 * Subject and judge jobs for assembled task sets (a list of tasks.js assembleTasks results). `exclusions` is the
 * loaded bench/exclusions.json (baseline.js loadExclusions); an excluded task has no reading A jobs.
 *   subject: [{ skill, batch, task, arm }]
 *   judge:   [{ skill, batch, task, scale, seat, model, arm }]
 */
function planJobs(taskSets, config, { exclusions = { batches: {} } } = {}) {
  const subject = [];
  const judge = [];
  const seats = seatsOf(config);
  for (const taskSet of taskSets) {
    const { skill } = taskSet;
    for (const { batch, read_b: readB, tasks } of taskSet.batches) {
      const { excluded } = exclusionsFor(
        exclusions,
        batch,
        tasks.map((task) => task.id),
      );
      for (const task of tasks) {
        for (const arm of ARMS) subject.push({ skill, batch, task, arm });
        const scales = [
          ...(readB ? ['items'] : []),
          ...(excluded.has(task.id) ? [] : ['outcome']),
        ];
        for (const scale of scales)
          for (const seat of seats)
            for (const arm of ARMS)
              judge.push({
                skill,
                batch,
                task,
                scale,
                seat,
                model: config.models.judges[seat],
                arm,
              });
      }
    }
  }
  return { subject, judge };
}

/**
 * Wraps a ledger (ledger.js createLedger) so a job can count the calls it charged at their mean because the CLI
 * reported no usable cost. The decision is the ledger's own: it is read from what `settle` returns (`cost_source`),
 * and `settle` returns it to the caller unchanged.
 * Returns { ledger, estimated } where `ledger` is used in place of the original and estimated() is null when every
 * call so far reported its cost, else { calls, models: { <model id>: calls } }.
 */
function trackEstimatedCalls(ledger) {
  const models = {};
  let calls = 0;
  const tracked = {
    ...ledger,
    async reserve(callUsd, label, options) {
      const reservation = await ledger.reserve(callUsd, label, options);
      return {
        ...reservation,
        settle(settlement = {}) {
          const charged = reservation.settle(settlement);
          if (charged.cost_source === 'estimate') {
            const model = String(
              settlement.model ?? reservation.model ?? '(no model recorded)',
            );
            models[model] = (models[model] || 0) + 1;
            calls += 1;
          }
          return charged;
        },
      };
    },
  };
  return {
    ledger: tracked,
    estimated: () => (calls ? { calls, models: { ...models } } : null),
  };
}

/** One log line for estimated() of trackEstimatedCalls, naming each model and its count. */
function estimatedCallsLine(estimated) {
  const perModel = Object.entries(estimated.models)
    .map(([model, count]) => `${model} ${count}`)
    .join(', ');
  return `${estimated.calls} call(s) charged at the estimate because the CLI reported no usable cost: ${perModel}`;
}

module.exports = {
  planJobs,
  trackEstimatedCalls,
  estimatedCallsLine,
};
