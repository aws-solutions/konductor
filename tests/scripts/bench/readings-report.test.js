// SPDX-License-Identifier: Apache-2.0
// The readings report (scripts/bench/lib/readings-report.js): reading A and reading B of one skill from its stored
// judgments, the task gaps and their t intervals, the coverage counts, exclusions and the length ratio. Pinned to
// the committed fixture tests/fixtures/bench/readings-report.json, never to live run data. Offline, no model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const readings = require('../../../scripts/bench/lib/readings-report');
const { taskGaps } = require('../../../scripts/bench/lib/judge-job');
const helpers = require('./helpers');
const {
  ARMS,
  READ,
  SEATS,
  buildDemo,
  judgeJob,
  validRecord,
} = require('./readings-report-fixture');

const near = (actual, expected, epsilon = 1e-3, message = '') =>
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${message} ${actual} is not within ${epsilon} of ${expected}`,
  );
const readDemo = (demo, skill, options = {}) =>
  readings.readSkill({ skill, ...buildDemo(demo, skill, options), ...READ });

test('readSkill on the fixture: A and B mean gaps and t intervals, by hand', () => {
  const summary = readDemo('helps-a', 'brew-log');
  assert.equal(summary.skill, 'brew-log');
  assert.equal(summary.tasks, 8);
  assert.equal(summary.A.scale, 'outcome');
  assert.equal(summary.B.scale, 'items');
  assert.equal(summary.A.tasks, 8);
  assert.equal(summary.A.tasks_counted, 8);
  near(summary.A.mean_gap, 1.0);
  // sd = sqrt(0.48 / 7); half width = t(0.975, 7) 2.3646 * sd / sqrt(8).
  const half = (2.3646 * Math.sqrt(0.48 / 7)) / Math.sqrt(8);
  near(summary.A.t_interval_exact[0], 1.0 - half, 1e-3);
  near(summary.A.t_interval_exact[1], 1.0 + half, 1e-3);
  assert.deepEqual(summary.A.t_interval, [0.7811, 1.2189]);
  near(summary.B.mean_gap, 1.875);
  assert.equal(summary.B_all, summary.B, 'no exclusion: B over all tasks is B');
  assert.deepEqual(summary.exclusions, []);
  assert.deepEqual(summary.A.judgments, {
    expected: 8 * SEATS.length * ARMS.length,
    done: 8 * SEATS.length * ARMS.length,
    pending: 0,
    waiting: 0,
    not_loaded: 0,
    ineligible: 0,
    other_arm_unusable: 0,
    stale: 0,
  });
  assert.equal(summary.A.not_counted.length, 0);
  assert.ok(summary.A.bootstrap_interval, 'the bootstrap interval is given');
});

test('the task gaps are the ones taskGaps gives, task by task', () => {
  const { outcomeJobs } = buildDemo('convention-pass', 'brew-log');
  const summary = readings.readingOf(outcomeJobs, {
    scale: 'outcome',
    ...READ,
  });
  const rows = taskGaps(outcomeJobs, READ);
  assert.deepEqual(
    summary.per_task.map((row) => [row.task_id, row.gap]),
    rows.map((row) => [row.task_id, Number(row.gap.toFixed(4))]),
  );
});

test('a task with too few valid seats, or an answer not loaded or not eligible, is not counted and says why', () => {
  const { outcomeJobs } = buildDemo('helps-a', 'brew-log');
  // Task 1: only one seat has valid judgments.
  for (const job of outcomeJobs.filter(
    (entry) => entry.task.id === 'brew-log-1' && entry.seat !== 'anthropic',
  )) {
    job.state = 'pending';
    job.record = null;
  }
  // Task 2: the without answer is stored as not loaded, so every without job of the task is not loaded.
  for (const job of outcomeJobs.filter(
    (entry) => entry.task.id === 'brew-log-2' && entry.arm === 'without',
  )) {
    job.state = 'not_loaded';
    job.reason = 'the without answer is stored as not loaded';
    job.record = null;
  }
  // Task 3: one judgment record says the with answer was not eligible.
  const ineligible = outcomeJobs.find(
    (entry) => entry.task.id === 'brew-log-3' && entry.arm === 'with',
  );
  ineligible.record = {
    ...ineligible.record,
    status: 'ineligible',
    reason: 'the with answer is not eligible: too much removed',
  };
  const summary = readings.readingOf(outcomeJobs, {
    scale: 'outcome',
    ...READ,
  });
  assert.equal(summary.tasks, 8);
  assert.equal(summary.tasks_counted, 5);
  assert.deepEqual(
    summary.not_counted.map((row) => [row.task_id, row.invalid]),
    [
      ['brew-log-1', '1 valid seat(s), need 2'],
      ['brew-log-2', 'the without answer is stored as not loaded'],
      ['brew-log-3', 'the with answer is not eligible: too much removed'],
    ],
  );
  // The mean is over the five counted tasks only: 1.4, 0.6, 1.0, 1.2, 0.8.
  near(summary.mean_gap, 1.0);
  assert.equal(summary.judgments.pending, 4);
  assert.equal(summary.judgments.not_loaded, 3);
  assert.equal(summary.judgments.done, 8 * SEATS.length * ARMS.length - 7);
});

test('a stale judgment file is counted as stale and never read; the default reader reads the judgment file', () => {
  helpers.withTmp((dir) => {
    const { outcomeJobs } = buildDemo('helps-a', 'brew-log');
    for (const [index, job] of outcomeJobs.entries()) {
      job.file = path.join(dir, `${index}.json`);
      fs.writeFileSync(job.file, JSON.stringify(job.record));
      delete job.record;
    }
    // Two with jobs of task 1 are pending: their files on disk were made from other inputs.
    for (const job of outcomeJobs
      .filter((entry) => entry.task.id === 'brew-log-1' && entry.arm === 'with')
      .slice(0, 2))
      job.state = 'pending';
    const summary = readings.readingOf(outcomeJobs, { scale: 'outcome' });
    assert.equal(summary.judgments.stale, 2);
    assert.equal(summary.judgments.pending, 2);
    assert.equal(summary.tasks_counted, 7, 'task 1 has one current seat left');
    assert.deepEqual(summary.not_counted, [
      {
        batch: 'b1',
        task_id: 'brew-log-1',
        invalid: '1 valid seat(s), need 2',
      },
    ]);
    // Without a file a pending job is not stale, only pending.
    for (const job of outcomeJobs) job.file = path.join(dir, 'missing.json');
    assert.equal(
      readings.readingOf(outcomeJobs, { scale: 'outcome' }).judgments.stale,
      0,
    );
  });
});

test('a seat counts only with a valid judgment for both arms; a redo of one arm keeps the other', () => {
  const { outcomeJobs } = buildDemo('helps-a', 'brew-log');
  // Task 1 loses its without judgment on two seats: those seats have one valid arm and do not count.
  const dropped = outcomeJobs.filter(
    (job) =>
      job.task.id === 'brew-log-1' &&
      job.arm === 'without' &&
      job.seat !== 'xai',
  );
  for (const job of dropped) {
    job.state = 'pending';
    job.record = null;
  }
  const summary = readings.readingOf(outcomeJobs, {
    scale: 'outcome',
    ...READ,
  });
  assert.equal(summary.tasks_counted, 7);
  assert.equal(summary.judgments.expected, 16 * SEATS.length);
  assert.deepEqual(summary.not_counted, [
    { batch: 'b1', task_id: 'brew-log-1', invalid: '1 valid seat(s), need 2' },
  ]);
  // One seat's without judgment is redone: that seat counts again, with the with judgment it already had.
  dropped[0].state = 'done';
  dropped[0].record = validRecord('outcome', dropped[0].seat, 'without', 1);
  const redone = readings.readingOf(outcomeJobs, {
    scale: 'outcome',
    ...READ,
  });
  assert.equal(redone.tasks_counted, 8);
  assert.equal(redone.per_task[0].seats_valid, 2);
  near(redone.per_task[0].gap, 1.2);
});

test('exclusions: A never reads an excluded task, B is read over the tasks A reads, and B_all over all of them', () => {
  const built = buildDemo('helps-a', 'brew-log');
  const excludedIds = ['brew-log-1', 'brew-log-4'];
  const outcomeJobs = built.outcomeJobs.filter(
    (job) => !excludedIds.includes(job.task.id),
  );
  const excluded = [
    ...excludedIds.map((id) => ({
      skill: 'brew-log',
      batch: 'b1',
      id,
      reason: 'the provider blocked the writer',
      date: '2026-11-01',
    })),
    // A record of another skill is not this skill's.
    {
      skill: 'pantry-note',
      batch: 'b1',
      id: 'brew-log-2',
      reason: 'x',
      date: '2026-11-01',
    },
  ];
  const summary = readings.readSkill({
    skill: 'brew-log',
    itemsJobs: built.itemsJobs,
    outcomeJobs,
    excluded,
    ...READ,
  });
  assert.equal(summary.tasks, 8);
  assert.equal(summary.A.tasks, 6);
  assert.equal(summary.B.tasks, 6);
  assert.equal(summary.B_all.tasks, 8);
  assert.notEqual(summary.B_all, summary.B);
  // B over tasks 2, 3, 5 to 8: 1.5, 2.5, 1.0, 2.0, 2.5, 1.5 = 11 / 6.
  near(summary.B.mean_gap, 11 / 6);
  near(summary.B_all.mean_gap, 1.875);
  assert.deepEqual(
    summary.exclusions.map((record) => record.id),
    excludedIds,
  );
  assert.deepEqual(Object.keys(summary.exclusions[0]).sort(), [
    'batch',
    'date',
    'id',
    'reason',
  ]);
});

test('an exclusion is per batch: the same task id in another batch stays in B', () => {
  const first = buildDemo('helps-a', 'brew-log', { batch: 'b1' });
  const second = buildDemo('helps-a', 'brew-log', { batch: 'b2' });
  const summary = readings.readSkill({
    skill: 'brew-log',
    itemsJobs: [...first.itemsJobs, ...second.itemsJobs],
    outcomeJobs: [
      ...first.outcomeJobs.filter((job) => job.task.id !== 'brew-log-1'),
      ...second.outcomeJobs,
    ],
    excluded: [
      {
        skill: 'brew-log',
        batch: 'b1',
        id: 'brew-log-1',
        reason: 'r',
        date: '2026-11-01',
      },
    ],
    ...READ,
  });
  assert.equal(summary.tasks, 16);
  assert.equal(summary.B.tasks, 15);
  assert.equal(summary.B_all.tasks, 16);
  assert.equal(summary.A.tasks, 15);
});

test('each batch is also read on its own, and the pooled reading is over every batch', () => {
  const first = buildDemo('helps-a', 'brew-log', { batch: 'b1' });
  const second = buildDemo('helps-a', 'brew-log', {
    batch: 'b2',
    override: { outcome: [-1, -1.2, -0.8, -1, -1.1, -0.9, -1, -1] },
  });
  const summary = readings.readingOf(
    [...first.outcomeJobs, ...second.outcomeJobs],
    { scale: 'outcome', ...READ },
  );
  assert.deepEqual(Object.keys(summary.by_batch), ['b1', 'b2']);
  near(summary.by_batch.b1.mean_gap, 1.0);
  near(summary.by_batch.b2.mean_gap, -1.0);
  assert.equal(summary.by_batch.b2.tasks_counted, 8);
  assert.ok(summary.by_batch.b2.t_interval[1] < 0);
  near(summary.mean_gap, 0);
  assert.equal(summary.tasks_counted, 16);
});

test('one counted task has a mean but no interval; none has neither', () => {
  const { outcomeJobs } = buildDemo('helps-a', 'brew-log');
  const oneTask = outcomeJobs.filter((job) => job.task.id === 'brew-log-1');
  const one = readings.readingOf(oneTask, { scale: 'outcome', ...READ });
  assert.equal(one.tasks_counted, 1);
  near(one.mean_gap, 1.2);
  assert.equal(one.t_interval, null);
  assert.equal(one.t_interval_exact, null);
  const none = readings.readingOf([], { scale: 'outcome', ...READ });
  assert.equal(none.tasks, 0);
  assert.equal(none.mean_gap, null);
  assert.equal(none.t_interval, null);
});

test('a skill with no judge job on either scale is reported, not crashed on; a missing scale reads empty', () => {
  const summary = readings.readSkill({ skill: 'brew-log', ...READ });
  assert.match(summary.error, /no judge job for brew-log/);
  const ladderOnly = readDemo('ladder-D1', 'fixture-d1');
  assert.equal(ladderOnly.B.tasks, 0, 'the ladder demo has no items jobs');
  assert.equal(ladderOnly.B.t_interval, null);
  assert.equal(ladderOnly.A.tasks_counted, 8);
  // Other skills' jobs are ignored.
  const other = buildDemo('helps-a', 'pantry-note');
  const mixed = readings.readSkill({
    skill: 'fixture-d1',
    ...buildDemo('ladder-D1', 'fixture-d1'),
    ...READ,
  });
  const withOther = readings.readSkill({
    skill: 'fixture-d1',
    itemsJobs: other.itemsJobs,
    outcomeJobs: [
      ...other.outcomeJobs,
      ...buildDemo('ladder-D1', 'fixture-d1').outcomeJobs,
    ],
    ...READ,
  });
  assert.deepEqual(withOther.A.per_task, mixed.A.per_task);
  assert.equal(withOther.B.tasks, 0);
});

test('bad input is refused with a clear message', () => {
  assert.throws(
    () => readings.readingOf([], { scale: 'blind' }),
    /scale must be one of outcome, items/,
  );
  const { itemsJobs } = buildDemo('helps-a', 'brew-log');
  assert.throws(
    () => readings.readingOf(itemsJobs, { scale: 'outcome', ...READ }),
    /jobs\[0\] is a items job; this reading reads outcome judgments only/,
  );
  assert.throws(
    () => readings.readingOf([{ scale: 'outcome' }], { scale: 'outcome' }),
    /jobs\[0\] must be a judge job/,
  );
  assert.throws(() => readings.readSkill({}), /skill must be a name/);
  assert.throws(
    () => readings.readSkill({ skill: 'brew-log', excluded: 'x' }),
    /excluded must be an array/,
  );
});

test('lengthRatio is the mean of per-task with / without word counts; the fixture answers are 31 and 61 words', () => {
  const ratio = readings.lengthRatio([
    { with: 30, without: 60 },
    { with: 90, without: 60 },
    { with: 10, without: 0 },
  ]);
  assert.equal(ratio.tasks, 2, 'a without answer with no words has no ratio');
  near(ratio.mean, 1.0);
  near(ratio.ratio_of_means, 130 / 120);
  assert.equal(readings.wordCount('  one two\nthree  '), 3);
  assert.equal(readings.wordCount(undefined), 0);
  assert.deepEqual(readings.lengthRatio([]), {
    tasks: 0,
    mean: null,
    ratio_of_means: null,
  });
  const summary = readDemo('helps-a', 'brew-log');
  assert.equal(
    summary.length_ratio.tasks,
    8,
    'one ratio per task, not per job',
  );
  near(summary.length_ratio.mean, 31 / 61, 1e-4);
  assert.equal(summary.length_ratio.per_task.length, 8);
});

test('the length ratio skips a job that carries no answer (waiting for the pairs job) and a task with one arm only', () => {
  const job = judgeJob({
    skill: 'brew-log',
    taskId: 't1',
    scale: 'outcome',
    seat: 'anthropic',
    arm: 'with',
    record: validRecord('outcome', 'anthropic', 'with', 1),
  });
  const waiting = {
    ...job,
    arm: 'without',
    state: 'waiting',
    answer: null,
    record: null,
  };
  const summary = readings.readSkill({
    skill: 'brew-log',
    outcomeJobs: [job, waiting],
    ...READ,
  });
  assert.equal(summary.length_ratio.tasks, 0);
  assert.deepEqual(summary.length_ratio.per_task, []);
  assert.equal(summary.A.judgments.waiting, 1);
});

test('readingOf carries the unrounded interval ends beside the rounded ones', () => {
  const { outcomeJobs } = buildDemo('helps-a', 'brew-log');
  const summary = readings.readingOf(outcomeJobs, {
    scale: 'outcome',
    ...READ,
  });
  const half = (2.3646 * Math.sqrt(0.48 / 7)) / Math.sqrt(8);
  assert.deepEqual(
    summary.t_interval_exact.map((end) => Number(end.toFixed(4))),
    summary.t_interval,
  );
  assert.notEqual(
    summary.t_interval_exact[0],
    summary.t_interval[0],
    'the exact end is not the rounded one',
  );
  assert.ok(Math.abs(summary.t_interval_exact[0] - (1 - half)) < 1e-3);
  for (const batch of Object.values(summary.by_batch))
    assert.notEqual(batch.t_interval_exact[0], batch.t_interval[0]);
});

test('every job is in exactly one count: other_arm_unusable has its own, and the counts add up to expected', () => {
  const { outcomeJobs } = buildDemo('helps-a', 'brew-log');
  // Task 1: the without answer is stored as not loaded. The with jobs of each seat were pending, so planJudging
  // holds them as other_arm_unusable.
  for (const job of outcomeJobs.filter(
    (entry) => entry.task.id === 'brew-log-1',
  )) {
    job.record = null;
    if (job.arm === 'without') {
      job.state = 'not_loaded';
      job.reason = 'the without answer is stored as not loaded';
    } else {
      job.state = 'other_arm_unusable';
      job.reason = 'not judged: the without answer is stored as not loaded';
    }
  }
  const { judgments } = readings.readingOf(outcomeJobs, {
    scale: 'outcome',
    ...READ,
  });
  assert.equal(judgments.expected, 8 * SEATS.length * ARMS.length);
  assert.equal(judgments.not_loaded, SEATS.length);
  assert.equal(judgments.other_arm_unusable, SEATS.length);
  assert.equal(judgments.done, 7 * SEATS.length * ARMS.length);
  const states = [
    'done',
    'pending',
    'waiting',
    'not_loaded',
    'ineligible',
    'other_arm_unusable',
  ];
  assert.equal(
    states.reduce((sum, state) => sum + judgments[state], 0),
    judgments.expected,
  );
});

test('a job in a state the report does not know is refused, not left out of the counts', () => {
  const { outcomeJobs } = buildDemo('helps-a', 'brew-log');
  outcomeJobs[0].state = 'blocked';
  assert.throws(
    () => readings.readingOf(outcomeJobs, { scale: 'outcome', ...READ }),
    /unknown judge job state "blocked"; known states are done, pending, waiting, not_loaded, ineligible, other_arm_unusable/,
  );
});

test('the isStale option decides which jobs count as stale, on both readings', () => {
  const built = buildDemo('helps-a', 'brew-log');
  const pend = (jobs, taskId, count) => {
    for (const job of jobs
      .filter((entry) => entry.task.id === taskId && entry.arm === 'with')
      .slice(0, count)) {
      job.state = 'pending';
      job.record = null;
    }
  };
  pend(built.outcomeJobs, 'brew-log-1', 2);
  pend(built.itemsJobs, 'brew-log-2', 1);
  const summary = readings.readSkill({
    skill: 'brew-log',
    ...built,
    ...READ,
    isStale: (job) => job.state === 'pending',
  });
  assert.equal(summary.A.judgments.stale, 2);
  assert.equal(summary.B.judgments.stale, 1);
  const none = readings.readSkill({ skill: 'brew-log', ...built, ...READ });
  assert.equal(none.A.judgments.stale, 0);
  assert.equal(none.A.judgments.pending, 2);
});

test('tasks counts every task of the skill, with an excluded task that has no job of its own', () => {
  const built = buildDemo('helps-a', 'brew-log');
  const summary = readings.readSkill({
    skill: 'brew-log',
    itemsJobs: built.itemsJobs,
    outcomeJobs: built.outcomeJobs.filter(
      (job) => job.task.id !== 'brew-log-1',
    ),
    excluded: [
      {
        skill: 'brew-log',
        batch: 'b1',
        id: 'brew-log-1',
        reason: 'r',
        date: '2026-11-01',
      },
      {
        skill: 'brew-log',
        batch: 'b1',
        id: 'brew-log-9',
        reason: 'r',
        date: '2026-11-01',
      },
    ],
    ...READ,
  });
  assert.equal(summary.tasks, 9, 'the 8 tasks with jobs and brew-log-9');
  assert.equal(summary.A.tasks, 7);
  assert.equal(summary.B.tasks, 7);
});

test('the length ratio counts the stored answers as written, not the text the judge was shown', () => {
  const built = buildDemo('helps-a', 'brew-log');
  for (const job of [...built.itemsJobs, ...built.outcomeJobs])
    job.shown = { text: 'a short stand-in' };
  const summary = readings.readSkill({ skill: 'brew-log', ...built, ...READ });
  near(summary.length_ratio.mean, 31 / 61, 1e-4);
  assert.equal(summary.length_ratio.per_task.length, 8);
});
