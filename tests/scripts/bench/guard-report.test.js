// SPDX-License-Identifier: Apache-2.0
// The guard report (scripts/bench/lib/guard-report.js): MET rates per skill, batch, bucket and arm, the per-task gaps
// with their intervals, and the guard reading with its loss flag, from stored `items` judgments. Each answer is judged
// on its own, so every seat has one judgment per arm. The judgments are built in memory (or written to a temp folder
// for the default reader). Offline, no model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const guardReport = require('../../../scripts/bench/lib/guard-report');
const { taskGaps } = require('../../../scripts/bench/lib/judge-job');
const {
  LABELS,
  scoreJudgment,
  scoreOf,
} = require('../../../scripts/bench/lib/judge-scale');
const helpers = require('./helpers');

const SKILL = 'brew-log';
const BATCH = 'b1';
const SEATS = ['anthropic', 'openai', 'xai'];
/** Items 1 to 3 value, 4 and 5 guard, 6 format. */
const BUCKETS_OF_ITEMS = [
  'value',
  'value',
  'value',
  'guard',
  'guard',
  'format',
];
const M = 'MET';
const P = 'PARTIAL';
const X = 'MISSING';
/** 6 labels from the value (3), guard (2) and format (1) parts. */
const labelsOf = (value, guard, format) => [...value, ...guard, ...format];
const ALL_MET = labelsOf([M, M, M], [M, M], [M]);
const NONE_MET = labelsOf([X, X, X], [X, X], [X]);

/** The score of a label list, or null for labels the report would refuse (taskGaps needs a number). */
const scoreOrNull = (labels) =>
  Array.isArray(labels) && labels.every((label) => LABELS.includes(label))
    ? scoreOf(labels)
    : null;

/** A valid items record of one seat and one arm. */
const armRecord = (seat, arm, labels, extra = {}) => ({
  kind: 'judgment',
  status: 'valid',
  scale: 'items',
  seat,
  arm,
  labels,
  score: scoreOrNull(labels),
  guard: null,
  ...extra,
});
/** The two records of one seat: its `with` judgment and its `without` judgment. */
const seatRecords = (seat, withLabels, withoutLabels) => [
  armRecord(seat, 'with', withLabels),
  armRecord(seat, 'without', withoutLabels),
];

/** A done judge job carrying its record, read back through the readRecord option. */
const doneJob = (
  taskId,
  record,
  { buckets = BUCKETS_OF_ITEMS, batch = BATCH, skill = SKILL } = {},
) => ({
  skill,
  batch,
  task: { id: taskId },
  scale: 'items',
  seat: record.seat,
  arm: record.arm,
  state: 'done',
  buckets,
  reason: null,
  record,
});
const pendingJob = (taskId, seat, arm, state = 'pending', reason = null) => ({
  skill: SKILL,
  batch: BATCH,
  task: { id: taskId },
  scale: 'items',
  seat,
  arm,
  state,
  buckets: BUCKETS_OF_ITEMS,
  reason,
  record: null,
});
const READ = { readRecord: (job) => job.record };

/** The done jobs of one seat, both arms. */
const seatJobs = (taskId, seat, withLabels, withoutLabels, options) =>
  seatRecords(seat, withLabels, withoutLabels).map((record) =>
    doneJob(taskId, record, options),
  );
/** One task judged by every seat with the same labels. */
const taskJobs = (taskId, withLabels, withoutLabels, options) =>
  SEATS.flatMap((seat) =>
    seatJobs(taskId, seat, withLabels, withoutLabels, options),
  );

const reportOf = (jobs, options = {}) =>
  guardReport.buildGuardReport(
    guardReport.collectBatches(jobs, { ...READ, ...options }),
  );
const entryOf = (report, skill = SKILL, batch = BATCH) =>
  report.skills[skill].batches[batch];

/** A one-answer reply of the items scale. */
const replyOf = (items) =>
  JSON.stringify({ items, reason: 'item 1 decided the labels' });

test('MET rate per bucket and arm: pooled over items and seats, PARTIAL is not met', () => {
  const without = labelsOf([X, M, P], [M, X], [X]);
  const entry = entryOf(reportOf(taskJobs('t1', ALL_MET, without)));
  assert.deepEqual(entry.buckets.value.with, {
    met: 9,
    partial: 0,
    missing: 0,
    n: 9,
    met_rate: 1,
  });
  assert.deepEqual(entry.buckets.value.without, {
    met: 3,
    partial: 3,
    missing: 3,
    n: 9,
    met_rate: 0.3333,
  });
  assert.deepEqual(
    [
      entry.buckets.guard.with.met_rate,
      entry.buckets.guard.without.met_rate,
      entry.buckets.format.without.met_rate,
    ],
    [1, 0.5, 0],
  );
  assert.deepEqual(
    [
      entry.buckets.value.items,
      entry.buckets.guard.items,
      entry.buckets.format.items,
    ],
    [3, 2, 1],
  );
  assert.deepEqual([entry.tasks, entry.tasks_counted], [1, 1]);
});

test("each arm's labels come from that arm's own judgment, in whatever job order the judgments arrive", () => {
  const jobs = SEATS.flatMap((seat) =>
    [
      ['without', NONE_MET],
      ['with', ALL_MET],
    ].map(([arm, items]) => {
      const scored = scoreJudgment({
        scale: 'items',
        text: replyOf(items),
        arm,
        buckets: BUCKETS_OF_ITEMS,
      });
      return doneJob(
        't1',
        armRecord(seat, scored.arm, scored.labels, {
          score: scored.score,
          guard: scored.guard,
        }),
      );
    }),
  );
  const entry = entryOf(reportOf(jobs));
  assert.equal(entry.buckets.value.with.met_rate, 1);
  assert.equal(entry.buckets.value.without.met_rate, 0);
  assert.equal(entry.guard.with_rate, 1);
  assert.equal(entry.guard.without_rate, 0);
  assert.deepEqual(entryOf(reportOf([...jobs].reverse())), entry);
});

test('pin: one value, one format and one guard item; B averages all three, the guard reading uses only the guard item', () => {
  const buckets = ['value', 'format', 'guard'];
  // with: value MET, format MET, guard MISSING. without: value MISSING, format MISSING, guard MET.
  const scoredOf = (arm, items) =>
    scoreJudgment({ scale: 'items', text: replyOf(items), arm, buckets });
  const scoredWith = scoredOf('with', [M, M, X]);
  const scoredWithout = scoredOf('without', [X, X, M]);
  const jobs = SEATS.flatMap((seat) =>
    [scoredWith, scoredWithout].map((scored) =>
      doneJob(
        't1',
        armRecord(seat, scored.arm, scored.labels, {
          score: scored.score,
          guard: scored.guard,
        }),
        { buckets },
      ),
    ),
  );
  // B: score = 1 + 4 * share met over all three items. with 2 of 3 -> 1 + 8/3; without 1 of 3 -> 1 + 4/3.
  assert.ok(Math.abs(scoredWith.score - (1 + 8 / 3)) < 1e-12);
  assert.ok(Math.abs(scoredWithout.score - (1 + 4 / 3)) < 1e-12);
  const [gapRow] = taskGaps(jobs, READ);
  assert.ok(
    Math.abs(gapRow.gap - 4 / 3) < 1e-12,
    'B is positive: the value and format items count',
  );
  // The guard reading sees item 3 only: with 0 of 3 labels met, without 3 of 3. A loss, while B went up.
  const entry = entryOf(reportOf(jobs));
  assert.equal(entry.guard.items, 1);
  assert.deepEqual(
    [entry.guard.with_rate, entry.guard.without_rate, entry.guard.loss],
    [0, 1, true],
  );
  assert.equal(entry.guard.gap.mean_gap, -1);
  assert.deepEqual(entry.per_task.value.per_task, [{ task_id: 't1', gap: 1 }]);
  assert.deepEqual(entry.per_task.format.per_task, [{ task_id: 't1', gap: 1 }]);
});

test('finished valid judgments only: failed, refused and other-scale records are ignored, wrong-length labels are listed', () => {
  const jobs = [
    doneJob('t1', armRecord(SEATS[0], 'with', ALL_MET, { status: 'failed' })),
    doneJob('t1', armRecord(SEATS[0], 'without', ALL_MET)),
    doneJob('t1', armRecord(SEATS[1], 'with', ALL_MET, { status: 'refused' })),
    doneJob('t1', armRecord(SEATS[1], 'without', ALL_MET)),
    doneJob('t1', armRecord(SEATS[2], 'with', ALL_MET, { scale: 'outcome' })),
    doneJob('t1', armRecord(SEATS[2], 'without', ALL_MET)),
  ];
  let entry = entryOf(reportOf(jobs));
  assert.equal(entry.buckets.value.with.n, 0);
  assert.equal(entry.buckets.value.with.met_rate, null);
  assert.equal(
    entry.buckets.value.without.n,
    0,
    'a seat with one valid arm adds nothing, not even its valid arm',
  );
  assert.deepEqual(entry.not_counted, [
    { task_id: 't1', invalid: '0 valid seat(s), need 2' },
  ]);
  const short = [
    ...seatJobs('t1', SEATS[0], [M, M], ALL_MET),
    ...seatJobs('t1', SEATS[1], ALL_MET, labelsOf([M, M, M], [M, M], ['met'])),
    ...seatJobs('t1', SEATS[2], ALL_MET, ALL_MET),
  ];
  entry = entryOf(reportOf(short));
  assert.equal(entry.tasks_counted, 0, 'one readable seat is not enough');
  assert.deepEqual(entry.problems, [
    `${SKILL}/${BATCH}/t1 seat anthropic with: the judgment has 2 with labels for 6 checklist items`,
    `${SKILL}/${BATCH}/t1 seat openai without: the judgment has a without label that is not one of MET, PARTIAL, MISSING`,
  ]);
});

test('a valid record with a seat or arm the layout would refuse is listed without its raw name and does not count', () => {
  const jobs = [
    ...seatJobs('t1', 'Bad|Seat\nname', ALL_MET, ALL_MET),
    doneJob('t1', armRecord(SEATS[1], 'sideways', ALL_MET)),
    doneJob('t1', armRecord(SEATS[1], 'without', ALL_MET)),
    ...seatJobs('t1', SEATS[2], ALL_MET, ALL_MET),
  ];
  const entry = entryOf(reportOf(jobs));
  assert.equal(entry.tasks_counted, 0);
  assert.deepEqual(entry.problems, [
    `${SKILL}/${BATCH}/t1: the judgment has no valid seat name or arm`,
    `${SKILL}/${BATCH}/t1: the judgment has no valid seat name or arm`,
    `${SKILL}/${BATCH}/t1: the judgment has no valid seat name or arm`,
  ]);
});

test('a task counts with 2 of 3 valid seats, like reading B; with 1 it does not and its labels are left out', () => {
  const jobs = [
    ...seatJobs('t1', SEATS[0], ALL_MET, NONE_MET),
    ...seatJobs('t1', SEATS[1], ALL_MET, NONE_MET),
    pendingJob('t1', SEATS[2], 'with'),
    pendingJob('t1', SEATS[2], 'without'),
    ...seatJobs('t2', SEATS[0], ALL_MET, ALL_MET),
    pendingJob('t2', SEATS[1], 'with'),
    pendingJob('t2', SEATS[1], 'without'),
    pendingJob('t2', SEATS[2], 'with'),
    pendingJob('t2', SEATS[2], 'without'),
  ];
  const entry = entryOf(reportOf(jobs));
  assert.deepEqual([entry.tasks, entry.tasks_counted], [2, 1]);
  assert.equal(
    entry.buckets.value.with.n,
    6,
    't1 only: 3 value items x 2 seats',
  );
  assert.deepEqual(entry.not_counted, [
    { task_id: 't2', invalid: '1 valid seat(s), need 2' },
  ]);
  // The same tasks count as in the task gap of reading B.
  const counted = taskGaps(jobs, READ).map((row) => [row.task_id, row.counted]);
  const collected = guardReport
    .collectBatches(jobs, READ)[0]
    .tasks.map((task) => [task.task_id, task.counted]);
  assert.deepEqual(collected, counted);
});

test('a task with an answer not loaded or not eligible does not count, with the reason', () => {
  const jobs = [
    ...taskJobs('t1', ALL_MET, ALL_MET),
    pendingJob(
      't2',
      SEATS[0],
      'with',
      'not_loaded',
      'the with answer did not load the skill',
    ),
    doneJob('t2', armRecord(SEATS[0], 'without', ALL_MET)),
    ...seatJobs('t2', SEATS[1], ALL_MET, ALL_MET),
    ...seatJobs('t2', SEATS[2], ALL_MET, ALL_MET),
    ...seatJobs('t3', SEATS[0], ALL_MET, ALL_MET),
    ...seatJobs('t3', SEATS[1], ALL_MET, ALL_MET),
    doneJob('t3', armRecord(SEATS[2], 'with', ALL_MET)),
    doneJob('t3', {
      kind: 'judgment',
      status: 'ineligible',
      scale: 'items',
      seat: SEATS[2],
      arm: 'without',
      reason: 'the without answer is not eligible: leak',
    }),
  ];
  const entry = entryOf(reportOf(jobs));
  assert.deepEqual(entry.not_counted, [
    { task_id: 't2', invalid: 'the with answer did not load the skill' },
    { task_id: 't3', invalid: 'the without answer is not eligible: leak' },
  ]);
  assert.equal(entry.tasks_counted, 1);
  assert.deepEqual(
    taskGaps(jobs, READ).map((row) => row.counted),
    [true, false, false],
  );
});

test('a planned job in state ineligible leaves its task out, as in reading B, with 2 other seats valid', () => {
  const reason =
    'the without answer is not eligible: sanitizer removed 80% of the answer';
  const jobs = [
    ...seatJobs('t1', SEATS[0], ALL_MET, ALL_MET),
    ...seatJobs('t1', SEATS[1], ALL_MET, ALL_MET),
    doneJob('t1', armRecord(SEATS[2], 'with', ALL_MET)),
    pendingJob('t1', SEATS[2], 'without', 'ineligible', reason),
  ];
  const entry = entryOf(reportOf(jobs));
  assert.equal(entry.tasks_counted, 0);
  assert.deepEqual(entry.not_counted, [{ task_id: 't1', invalid: reason }]);
  assert.equal(entry.buckets.guard.with.n, 0);
  const [gapRow] = taskGaps(jobs, READ);
  assert.deepEqual([gapRow.counted, gapRow.invalid], [false, reason]);
});

test('a valid record that names another seat or arm than its job is listed and does not count', () => {
  const jobs = [
    ...seatJobs('t1', SEATS[0], ALL_MET, ALL_MET),
    ...seatJobs('t1', SEATS[1], ALL_MET, ALL_MET),
    // The with job of seat 2 holds a record that says seat 0.
    {
      ...doneJob('t1', armRecord(SEATS[0], 'with', NONE_MET)),
      seat: SEATS[2],
      arm: 'with',
    },
    doneJob('t1', armRecord(SEATS[2], 'without', ALL_MET)),
    // The without job of seat 1 holds a record that says `with`.
    ...seatJobs('t2', SEATS[0], ALL_MET, ALL_MET),
    ...seatJobs('t2', SEATS[2], ALL_MET, ALL_MET),
    doneJob('t2', armRecord(SEATS[1], 'with', ALL_MET)),
    {
      ...doneJob('t2', armRecord(SEATS[1], 'with', NONE_MET)),
      seat: SEATS[1],
      arm: 'without',
    },
  ];
  const entry = entryOf(reportOf(jobs));
  assert.deepEqual(entry.problems, [
    `${SKILL}/${BATCH}/t1 seat xai with: the judgment names another seat or arm than the job it was read for`,
    `${SKILL}/${BATCH}/t2 seat openai without: the judgment names another seat or arm than the job it was read for`,
  ]);
  // Seat 2 of t1 and seat 1 of t2 each lack an arm and drop out; no other seat's labels were replaced.
  assert.equal(entry.tasks_counted, 2);
  assert.deepEqual(
    [entry.buckets.value.with.met, entry.buckets.value.with.n],
    [12, 12],
    '2 tasks x 2 seats x 3 value items, none of them from the foreign records',
  );
});

test('a valid record with no labels array, and a counted job with no bucket list, are listed and do not count', () => {
  const noLabels = [
    ...seatJobs('t1', SEATS[0], ALL_MET, ALL_MET),
    ...seatJobs('t1', SEATS[1], ALL_MET, ALL_MET),
    doneJob('t1', armRecord(SEATS[2], 'with', null)),
    doneJob('t1', armRecord(SEATS[2], 'without', ALL_MET)),
  ];
  let entry = entryOf(reportOf(noLabels));
  assert.deepEqual(entry.problems, [
    `${SKILL}/${BATCH}/t1 seat xai with: the judgment has no with labels`,
  ]);
  assert.equal(entry.tasks_counted, 1, 'the other 2 seats still count');
  const noBuckets = taskJobs('t1', ALL_MET, ALL_MET, { buckets: null });
  entry = entryOf(reportOf(noBuckets));
  assert.deepEqual(
    entry.problems,
    SEATS.flatMap((seat) =>
      ['with', 'without'].map(
        (arm) =>
          `${SKILL}/${BATCH}/t1 seat ${seat} ${arm}: the judgment has no bucket list for its checklist`,
      ),
    ),
  );
  assert.deepEqual(entry.not_counted, [
    { task_id: 't1', invalid: '0 valid seat(s), need 2' },
  ]);
});

test('a seat counts only with a valid judgment for both arms, and a later judgment for the same seat and arm wins', () => {
  const jobs = [
    ...seatJobs('t1', SEATS[0], ALL_MET, ALL_MET),
    ...seatJobs('t1', SEATS[1], ALL_MET, ALL_MET),
    // Seat 2 has only its with judgment: its labels are left out of both arms.
    doneJob('t1', armRecord(SEATS[2], 'with', NONE_MET)),
  ];
  let entry = entryOf(reportOf(jobs));
  assert.deepEqual(
    [entry.buckets.value.with.met, entry.buckets.value.with.n],
    [6, 6],
    '2 seats x 3 value items',
  );
  assert.equal(entry.buckets.value.without.n, 6);
  // A redo of seat 0, with, replaces the earlier one and leaves its without judgment as it was.
  jobs.push(doneJob('t1', armRecord(SEATS[0], 'with', NONE_MET)));
  entry = entryOf(reportOf(jobs));
  assert.deepEqual(
    [entry.buckets.value.with.met, entry.buckets.value.with.n],
    [3, 6],
  );
  assert.equal(entry.buckets.value.without.met, 6);
  // Seat 2's without judgment arrives: now seat 2 counts too.
  jobs.push(doneJob('t1', armRecord(SEATS[2], 'without', ALL_MET)));
  entry = entryOf(reportOf(jobs));
  assert.deepEqual(
    [entry.buckets.value.with.met, entry.buckets.value.with.n],
    [3, 9],
  );
  assert.deepEqual(
    [entry.buckets.value.without.met, entry.buckets.value.without.n],
    [9, 9],
  );
});

test('per-task gaps: each task is one point, pooled over its items and seats, with the t and bootstrap intervals', () => {
  // Value items met with 3,3,2,3 of 3; without 1,2,2,0: gaps 2/3, 1/3, 0, 1 -> mean 0.5, sd 0.43033, se 0.21517,
  // t(3) = 3.1824: half-width 0.68476.
  const kValue = (met) =>
    labelsOf([...Array(met).fill(M), ...Array(3 - met).fill(X)], [M, M], [M]);
  const jobs = [
    ['t1', 3, 1],
    ['t2', 3, 2],
    ['t3', 2, 2],
    ['t4', 3, 0],
  ].flatMap(([id, withMet, withoutMet]) =>
    taskJobs(id, kValue(withMet), kValue(withoutMet)),
  );
  const entry = entryOf(reportOf(jobs));
  const gap = entry.per_task.value;
  assert.equal(gap.tasks, 4);
  assert.ok(Math.abs(gap.mean_gap - 0.5) < 1e-4);
  assert.ok(Math.abs(gap.t_interval[0] - (0.5 - 0.68476)) < 2e-4);
  assert.ok(Math.abs(gap.t_interval[1] - (0.5 + 0.68476)) < 2e-4);
  assert.ok(Math.abs(gap.t_interval_exact[0] - (0.5 - 0.68476)) < 2e-4);
  assert.equal(gap.bootstrap_interval.length, 2);
  assert.ok(gap.bootstrap_interval[0] >= 0 && gap.bootstrap_interval[1] <= 1);
  assert.deepEqual(
    gap.per_task.map((row) => [row.task_id, row.gap]),
    [
      ['t1', 0.6667],
      ['t2', 0.3333],
      ['t3', 0],
      ['t4', 1],
    ],
  );
  // The guard and format items are met in both arms: no gap, and no loss.
  assert.equal(entry.per_task.guard.mean_gap, 0);
  assert.deepEqual(entry.guard.gap.t_interval, [0, 0]);
  assert.equal(entry.guard.loss, false);
  // The pooled table: 11 of 12 seat-labels per seat (3+3+2+3) against 5 of 12 (1+2+2+0), times 3 seats.
  assert.deepEqual(
    [
      entry.buckets.value.with.met,
      entry.buckets.value.with.n,
      entry.buckets.value.without.met,
    ],
    [33, 36, 15],
  );
});

test('guard loss: with below without is a loss; equal or above is not; a PARTIAL is not a MET', () => {
  const run = (guardWith, guardWithout) =>
    reportOf(
      taskJobs(
        't1',
        labelsOf([M, M, M], guardWith, [M]),
        labelsOf([M, M, M], guardWithout, [M]),
      ),
    );
  const lost = run([M, X], [M, M]);
  assert.deepEqual(
    [
      entryOf(lost).guard.loss,
      entryOf(lost).guard.with_rate,
      entryOf(lost).guard.without_rate,
    ],
    [true, 0.5, 1],
  );
  assert.deepEqual(lost.loss, [{ skill: SKILL, batch: BATCH }]);
  assert.equal(entryOf(run([M, M], [M, M])).guard.loss, false);
  assert.equal(entryOf(run([M, M], [M, X])).guard.loss, false);
  assert.deepEqual(run([M, M], [M, X]).loss, []);
  assert.equal(
    entryOf(run([P, M], [M, M])).guard.loss,
    true,
    'a PARTIAL is not a MET',
  );
});

test('guard loss is decided on the exact rates, so two rates that print the same can still be a loss', () => {
  // One task, 100 guard items, 1000 seats: 100000 labels per arm. with 66661 MET, without 66662: both rates
  // print as 0.6666, yet with is below without.
  const itemCount = 100;
  const seatCount = 1000;
  const labelRows = (metCount) => {
    const flat = Array.from({ length: itemCount * seatCount }, (_, i) =>
      i < metCount ? M : X,
    );
    return Array.from({ length: seatCount }, (_, j) =>
      flat.slice(j * itemCount, (j + 1) * itemCount),
    );
  };
  const withRows = labelRows(66661);
  const withoutRows = labelRows(66662);
  const task = {
    task_id: 't1',
    buckets: Array(itemCount).fill('guard'),
    counted: true,
    invalid: null,
    seats: seatCount,
    judgments: withRows.map((row, j) => ({
      seat: `seat-${j}`,
      labels: { with: row, without: withoutRows[j] },
    })),
  };
  const entry = guardReport.buildBatchEntry({
    skill: SKILL,
    batch: BATCH,
    tasks: [task],
  });
  assert.equal(entry.buckets.guard.with.met, 66661);
  assert.equal(entry.buckets.guard.without.met, 66662);
  assert.equal(entry.guard.with_rate, 0.6666);
  assert.equal(
    entry.guard.with_rate,
    entry.guard.without_rate,
    'the shown rates are equal',
  );
  assert.equal(entry.guard.loss, true);
});

test('a skill with no generic rule has no guard items and prints "no guard data"; so does a batch with no counted task', () => {
  const noGuard = ['value', 'value', 'value', 'format', 'format', 'format'];
  const jobs = taskJobs('t1', ALL_MET, ALL_MET, { buckets: noGuard });
  const report = reportOf(jobs);
  const { guard } = entryOf(report);
  assert.deepEqual(guard, {
    data: false,
    note: 'no guard data',
    reason: 'the checklists have no guard item (the skill has no generic rule)',
    items: 0,
    with_rate: null,
    without_rate: null,
    loss: null,
    gap: null,
  });
  assert.deepEqual(report.loss, []);
  const empty = entryOf(reportOf([pendingJob('t1', SEATS[0], 'with')]));
  assert.equal(empty.guard.note, guardReport.NO_GUARD_DATA);
  assert.equal(empty.guard.reason, 'no task counted');
  assert.equal(empty.per_task.guard.mean_gap, null);
});

test('the report keeps skills and batches apart, in input order, and names every loss batch', () => {
  const lossLabels = labelsOf([M, M, M], [X, X], [M]);
  const jobs = [
    ...taskJobs('t1', lossLabels, ALL_MET, {
      skill: 'pantry-note',
      batch: 'b2',
    }),
    ...taskJobs('t1', ALL_MET, ALL_MET),
    ...taskJobs('t1', lossLabels, ALL_MET, { batch: 'b2' }),
  ];
  const report = reportOf(jobs);
  assert.equal(report.version, guardReport.GUARD_REPORT_VERSION);
  assert.deepEqual(Object.keys(report.skills), ['pantry-note', SKILL]);
  assert.deepEqual(Object.keys(report.skills[SKILL].batches), [BATCH, 'b2']);
  assert.deepEqual(report.loss, [
    { skill: 'pantry-note', batch: 'b2' },
    { skill: SKILL, batch: 'b2' },
  ]);
  assert.match(report.definitions.met_rate, /PARTIAL counts as not met/);
  assert.match(report.definitions.guard, /changes nothing/);
});

test("the default reader reads each done job's judgment file from disk", () =>
  helpers.withTmp((dir) => {
    const jobs = SEATS.flatMap((seat) =>
      seatRecords(seat, labelsOf([M, M, M], [M, X], [M]), ALL_MET).map(
        (record) => {
          const file = path.join(dir, `${seat}.${record.arm}.json`);
          fs.writeFileSync(file, JSON.stringify(record));
          const job = doneJob('t1', record);
          return { ...job, record: undefined, file };
        },
      ),
    );
    // A done job whose file is gone or broken reads as no record, the way taskGaps reads it: seat 2 loses its with
    // judgment and so does not count.
    fs.writeFileSync(jobs[4].file, '{ not json');
    const entry = entryOf(
      guardReport.buildGuardReport(guardReport.collectBatches(jobs)),
    );
    assert.equal(entry.tasks_counted, 1);
    assert.equal(entry.buckets.guard.with.n, 4, '2 seats x 2 guard items');
    assert.equal(entry.guard.with_rate, 0.5);
  }));

test('buildBatchEntry refuses a counted task with no bucket list or judgments, or a label that is not MET, PARTIAL or MISSING', () => {
  const task = (extra = {}) => ({
    task_id: 't1',
    buckets: BUCKETS_OF_ITEMS,
    counted: true,
    invalid: null,
    seats: 1,
    judgments: [
      { seat: SEATS[0], labels: { with: ALL_MET, without: ALL_MET } },
    ],
    ...extra,
  });
  const build = (row) =>
    guardReport.buildBatchEntry({ skill: SKILL, batch: BATCH, tasks: [row] });
  assert.equal(build(task()).tasks_counted, 1);
  assert.throws(
    () =>
      build(
        task({
          judgments: [
            { seat: SEATS[0], labels: { with: ALL_MET, without: ALL_MET } },
            {
              seat: SEATS[1],
              labels: {
                with: ALL_MET,
                without: [...ALL_MET.slice(0, 5), 'met'],
              },
            },
          ],
        }),
      ),
    /brew-log\/b1\/t1: judgments\[1\] has a without label that is not one of MET, PARTIAL, MISSING/,
  );
  assert.throws(
    () =>
      build(
        task({
          judgments: [{ seat: SEATS[0], labels: { with: ALL_MET } }],
        }),
      ),
    /judgments\[0\] has no without labels/,
  );
  assert.throws(
    () =>
      build(
        task({
          judgments: [
            {
              seat: SEATS[0],
              labels: { with: ALL_MET.slice(1), without: ALL_MET },
            },
          ],
        }),
      ),
    /judgments\[0\] has 5 with labels for 6 checklist items/,
  );
  assert.throws(
    () => build(task({ buckets: null })),
    /brew-log\/b1\/t1: a counted task needs its bucket list/,
  );
  assert.throws(
    () => build(task({ judgments: null })),
    /brew-log\/b1\/t1: a counted task needs its judgments/,
  );
  // A task that does not count needs neither.
  assert.equal(
    build({ task_id: 't1', counted: false, invalid: 'x' }).tasks_counted,
    0,
  );
});

test('the report lists a batch named by a whole number first, in numeric order; a skill named constructor is a skill', () => {
  const jobs = ['10', '9', 'b1'].flatMap((batch) =>
    taskJobs('t1', ALL_MET, ALL_MET, { skill: 'constructor', batch }),
  );
  const report = reportOf(jobs);
  assert.deepEqual(Object.keys(report.skills), ['constructor']);
  assert.deepEqual(Object.keys(report.skills.constructor.batches), [
    '9',
    '10',
    'b1',
  ]);
  assert.equal(report.skills.constructor.batches['9'].tasks_counted, 1);
});

test('a returned report is its own copy: changing it changes neither the definitions nor the input problems', () => {
  const batches = guardReport.collectBatches(
    [...seatJobs('t1', SEATS[0], [M, M], ALL_MET)],
    READ,
  );
  assert.equal(batches[0].problems.length, 1);
  const before = JSON.stringify(guardReport.DEFINITIONS);
  const report = guardReport.buildGuardReport(batches);
  report.definitions.met_rate = 'changed';
  entryOf(report).problems.push('another');
  assert.equal(JSON.stringify(guardReport.DEFINITIONS), before);
  assert.equal(batches[0].problems.length, 1);
  assert.equal(
    guardReport.buildGuardReport(batches).definitions.met_rate,
    guardReport.DEFINITIONS.met_rate,
  );
});

test('bad input is refused: an outcome job, a job without a task, a batch given twice, an unknown bucket', () => {
  assert.throws(
    () =>
      guardReport.collectBatches(
        [{ ...pendingJob('t1', SEATS[0], 'with'), scale: 'outcome' }],
        READ,
      ),
    /outcome job; the guard report reads items judgments only/,
  );
  assert.throws(
    () => guardReport.collectBatches([{ scale: 'items' }], READ),
    /jobs\[0\] must be a judge job/,
  );
  assert.throws(
    () => guardReport.collectBatches('jobs'),
    /jobs must be an array/,
  );
  const batch = guardReport.collectBatches(
    taskJobs('t1', ALL_MET, ALL_MET),
    READ,
  )[0];
  assert.throws(
    () => guardReport.buildGuardReport([batch, batch]),
    /brew-log\/b1 appears twice/,
  );
  const badBucket = {
    ...batch,
    tasks: [
      {
        ...batch.tasks[0],
        buckets: ['value', 'value', 'value', 'guard', 'guard', 'style'],
      },
    ],
  };
  assert.throws(
    () => guardReport.buildGuardReport([badBucket]),
    /item 6 has the unknown bucket "style"/,
  );
});
