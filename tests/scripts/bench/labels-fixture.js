// SPDX-License-Identifier: Apache-2.0
// Builds the readings and guard entries of the label tests from the committed fixture tests/fixtures/bench/labels.json:
// two batches of 8 tasks per skill, one valid judgment per task, seat, arm and scale (each answer is judged on its
// own), read back through the readRecord option, and one guard report entry per batch. Nothing is written.
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { readSkill } = require('../../../scripts/bench/lib/readings-report');
const {
  ARMS,
  SEATS,
  judgeJob,
  scoresForGap,
  validRecord,
} = require('./readings-report-fixture');

const FIXTURE = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'bench',
  'labels.json',
);
const DATA = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const READ = Object.freeze({
  readRecord: (job) => job.record,
  isStale: () => false,
});

/**
 * The judge jobs of a fixture skill: { itemsJobs, outcomeJobs }. Every seat gives a task its fixture gap. Task ids
 * repeat across batches (`<skill>-1` to `<skill>-8` in each). `override[scale][batchIndex]` replaces a batch's gaps.
 */
function jobsOf(skill, { override = {} } = {}) {
  const spec = DATA.skills[skill];
  assert.ok(spec, `fixture skill ${skill} is missing`);
  const jobs = { items: [], outcome: [] };
  for (const [scale, key] of [
    ['items', 'B'],
    ['outcome', 'A'],
  ])
    DATA.batches.forEach((batch, batchIndex) => {
      const gaps =
        (override[scale] && override[scale][batchIndex]) ||
        spec[key][batchIndex];
      gaps.forEach((gap, index) => {
        const taskId = `${skill}-${index + 1}`;
        const scores = scoresForGap(gap);
        for (const seat of SEATS)
          for (const arm of ARMS)
            jobs[scale].push(
              judgeJob({
                skill,
                batch,
                taskId,
                scale,
                seat,
                arm,
                record: validRecord(scale, seat, arm, scores[arm]),
              }),
            );
      });
    });
  return { itemsJobs: jobs.items, outcomeJobs: jobs.outcome };
}

/** readSkill of a fixture skill, with the given extra options (excluded, isStale, ...). */
function summaryOf(skill, { jobs = jobsOf(skill), ...options } = {}) {
  return readSkill({ skill, ...jobs, ...READ, ...options });
}

/** The guard report batch entries of a fixture skill, shaped as guard-report.js buildBatchEntry gives them. */
function guardEntriesOf(skill) {
  const spec = DATA.skills[skill];
  return Object.fromEntries(
    DATA.batches.map((batch, batchIndex) => {
      const guard = spec.guard[batchIndex];
      return [
        batch,
        {
          skill,
          batch,
          guard: {
            data: true,
            note: null,
            items: 2,
            with_rate: guard.with,
            without_rate: guard.without,
            loss: guard.loss,
            gap: {
              per_task: guard.gaps.map((gap, index) => ({
                task_id: `${skill}-${index + 1}`,
                gap,
              })),
            },
          },
        },
      ];
    }),
  );
}

module.exports = {
  DATA,
  READ,
  jobsOf,
  summaryOf,
  guardEntriesOf,
};
