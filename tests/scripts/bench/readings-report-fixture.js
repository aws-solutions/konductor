// SPDX-License-Identifier: Apache-2.0
// Builds the judge jobs of the readings report tests from the committed fixture
// tests/fixtures/bench/readings-report.json: one job per task, seat and arm for each scale a demo has, each carrying
// a valid judgment record of that arm alone (read back through the readRecord option) and that arm's stored answer.
// Nothing is written.
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FIXTURE = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'bench',
  'readings-report.json',
);
const DATA = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const SEATS = Object.freeze(['anthropic', 'openai', 'xai']);
const ARMS = Object.freeze(['with', 'without']);
const BATCH = 'b1';
const READ = Object.freeze({
  readRecord: (job) => job.record,
  isStale: () => false,
});

const words = (count) =>
  Array.from({ length: count }, (_, index) => `w${index}`).join(' ');

/** A valid judgment record of one seat and one arm with the given score. */
const validRecord = (scale, seat, arm, score, extra = {}) => ({
  kind: 'judgment',
  status: 'valid',
  scale,
  seat,
  arm,
  score,
  guard: null,
  ...extra,
});

/**
 * The two scores that give a task gap of `gap` on the 1 to 5 scale: the lower arm scores 1, the other 1 + |gap|.
 */
const scoresForGap = (gap) =>
  gap >= 0 ? { with: 1 + gap, without: 1 } : { with: 1, without: 1 - gap };

/** One judge job as planJudging lists it, in state `done` unless `record` is null. */
const judgeJob = ({
  skill,
  batch = BATCH,
  taskId,
  scale,
  seat,
  arm,
  record,
}) => ({
  skill,
  batch,
  task: { id: taskId },
  scale,
  seat,
  arm,
  file: null,
  state: record ? 'done' : 'pending',
  reason: null,
  answer: { text: `${words(DATA.words[arm])} ${taskId}` },
  record,
});

/**
 * The jobs of one fixture demo for `skill`: { itemsJobs, outcomeJobs, taskIds }. `override[scale]` replaces a
 * scale's gaps; `batch` names the batch of every task.
 */
function buildDemo(demo, skill, { override = {}, batch = BATCH } = {}) {
  const spec = DATA.demos[demo];
  assert.ok(spec, `fixture demo ${demo} is missing`);
  const jobs = { items: [], outcome: [] };
  const count = Object.values(spec)[0].gap.length;
  const taskIds = Array.from(
    { length: count },
    (_, index) => `${skill}-${index + 1}`,
  );
  for (const scale of Object.keys(jobs)) {
    const gaps = override[scale] || (spec[scale] && spec[scale].gap);
    if (!gaps) continue;
    taskIds.forEach((taskId, index) => {
      const scores = scoresForGap(gaps[index]);
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
  }
  return { itemsJobs: jobs.items, outcomeJobs: jobs.outcome, taskIds };
}

module.exports = {
  DATA,
  SEATS,
  ARMS,
  BATCH,
  READ,
  validRecord,
  scoresForGap,
  judgeJob,
  buildDemo,
};
