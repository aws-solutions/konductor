// SPDX-License-Identifier: Apache-2.0
/**
 * The guard report: for each skill and batch, the share of rules checklist items met with and without the skill,
 * per bucket (value, guard, format), and the guard reading. Offline: it reads stored `items` judgments (reading B)
 * and makes no call.
 *
 * Where the numbers come from. Every rules checklist item has a bucket from the bucket sidecar (formats.js:
 * `useful` rules give `value`, `style` give `format`, `generic` give `guard`). Each answer is judged on its own, so a
 * valid `items` judgment holds one label per item for its one arm (judge-job.js validRecord `arm` and `labels`); a
 * seat's figures pair its `with` judgment with its `without` judgment.
 *
 *   MET rate   MET labels / all labels of the bucket, pooled over the bucket's items and the counted judgments.
 *              PARTIAL counts as not met, so the rate reads "met in full".
 *   per task   each task's MET rate with minus its MET rate without, in the bucket, pooled over the task's items and
 *              counted judgments. Each task is one point. Mean, 95% t interval and 95% paired bootstrap interval
 *              over the tasks (gap-stats.js).
 *   guard      the guard bucket only: both MET rates, `loss` (the with rate is below the without rate, compared
 *              before rounding, so two rates that print the same can still be a loss) and the per-task gap with its
 *              intervals. A batch with no guard item (a skill with no `generic` rule) has no guard reading and
 *              prints "no guard data".
 *
 * Which judgments count. The same tasks and seats as the task gap of reading B (judge-job.js taskGaps and
 * judge-scale.js aggregateTask), so the guard figure is never read from a task the reading leaves out:
 *   - a task with an answer that is not loaded or not eligible does not count;
 *   - a seat counts when it has a valid judgment for both arms; a later judgment for the same seat and arm replaces
 *     an earlier one;
 *   - a task counts when at least MIN_SEATS seats count. A task that does not count is listed with the reason.
 *
 * One check reading B does not make when it reads a file: a valid record must name the seat and arm of the job it
 * was read for. A record that names another seat or arm is listed as a problem and does not count. (planJudging
 * already treats such a file as not current, so a job is `done` only when they match; the check covers a file
 * changed after the plan was made, or a reader that returns another job's record.)
 *
 * The guard result is shown beside the label and changes nothing: reading B and the label use every item of the
 * checklist, whatever its bucket. The value and format figures are kept for later work and no rule reads them.
 */
'use strict';

const { BUCKETS } = require('./formats');
const { gapStats, round4 } = require('./gap-stats');
const {
  STATUS_INELIGIBLE,
  STATUS_VALID,
  readJudgment,
} = require('./judge-job');
const { LABELS, MIN_SEATS } = require('./judge-scale');
const { ARMS } = require('./layout');
const { SEAT_NAME } = require('./names');

const GUARD_REPORT_VERSION = 1;
const GUARD_BUCKET = 'guard';
const NO_GUARD_DATA = 'no guard data';
const ITEMS_SCALE = 'items';
/** Job states that make a task an invalid task for the reading (judge-job.js planJudging). */
const BLOCKING_STATES = Object.freeze(['not_loaded', 'ineligible']);

const DEFINITIONS = Object.freeze({
  met_rate:
    'MET labels / all labels of the bucket, pooled over its items and the counted judge seats; PARTIAL counts as not met',
  per_task_gap:
    'per task: MET rate with minus MET rate without in the bucket; mean over the counted tasks with a 95% t interval (df = tasks - 1) and a 95% paired bootstrap interval',
  loss: 'true when the guard MET rate with the skill is below the rate without it, compared before rounding, so two rates that print the same can still be a loss',
  guard:
    'shown beside the label and changes nothing; a batch with no guard item prints "no guard data"',
});

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const taskKey = (skill, batch, taskId) =>
  `${skill}\u0000${batch}\u0000${taskId}`;
const batchKey = (skill, batch) => `${skill}\u0000${batch}`;

/** Why `labels` cannot be read as one label per checklist item for `arm`, or null when it can. */
function labelProblem(labels, arm, itemCount) {
  if (!Array.isArray(labels)) return `has no ${arm} labels`;
  if (labels.length !== itemCount)
    return `has ${labels.length} ${arm} labels for ${itemCount} checklist items`;
  if (labels.some((label) => !LABELS.includes(label)))
    return `has a ${arm} label that is not one of ${LABELS.join(', ')}`;
  return null;
}

/**
 * The input of the guard report from the `items` judge jobs of a run (judge-job.js planJudging with scale `items`)
 * and their stored records. `readRecord(job)` reads a done job's record (default: its judgment file, as taskGaps
 * reads it). Returns, in job order,
 *   [{ skill, batch, tasks: [{ task_id, buckets, counted, invalid, seats, judgments }], problems }]
 * where `judgments` are the counted seats ({ seat, labels: { with, without } }, each arm's labels from that arm's
 * own judgment) and `problems` lists the valid records that could not be read (labels that do not fit the
 * checklist): such a record does not count.
 */
function collectBatches(
  jobs,
  { readRecord = (job) => readJudgment(job.file) } = {},
) {
  if (!Array.isArray(jobs)) throw new TypeError('jobs must be an array');
  const batches = new Map();
  const tasks = new Map();
  jobs.forEach((job, index) => {
    if (!isPlainObject(job) || !isPlainObject(job.task))
      throw new TypeError(`jobs[${index}] must be a judge job`);
    if (job.scale !== ITEMS_SCALE)
      throw new TypeError(
        `jobs[${index}] is a ${job.scale} job; the guard report reads ${ITEMS_SCALE} judgments only`,
      );
    const bKey = batchKey(job.skill, job.batch);
    if (!batches.has(bKey))
      batches.set(bKey, {
        skill: job.skill,
        batch: job.batch,
        tasks: [],
        problems: [],
      });
    const tKey = taskKey(job.skill, job.batch, job.task.id);
    if (!tasks.has(tKey)) {
      const row = {
        task_id: job.task.id,
        buckets: null,
        blocked: null,
        bySeat: new Map(),
      };
      tasks.set(tKey, row);
      batches.get(bKey).tasks.push(row);
    }
    const row = tasks.get(tKey);
    if (Array.isArray(job.buckets) && !row.buckets) row.buckets = job.buckets;
    if (BLOCKING_STATES.includes(job.state))
      row.blocked = row.blocked || job.reason || job.state;
    if (job.state !== 'done') return;
    const record = readRecord(job);
    if (!isPlainObject(record) || record.scale !== ITEMS_SCALE) return;
    if (record.status === STATUS_INELIGIBLE) {
      row.blocked = row.blocked || record.reason || STATUS_INELIGIBLE;
      return;
    }
    if (record.status !== STATUS_VALID) return;
    // The seat and arm are the job's, and the record must say the same. A name the layout would refuse is never used
    // as a key or printed.
    const hasNames =
      typeof job.seat === 'string' &&
      SEAT_NAME.test(job.seat) &&
      ARMS.includes(job.arm);
    const where = hasNames
      ? `${job.skill}/${job.batch}/${job.task.id} seat ${job.seat} ${job.arm}`
      : `${job.skill}/${job.batch}/${job.task.id}`;
    const buckets = row.buckets;
    const problem = !hasNames
      ? 'has no valid seat name or arm'
      : record.seat !== job.seat || record.arm !== job.arm
        ? 'names another seat or arm than the job it was read for'
        : !buckets
          ? 'has no bucket list for its checklist'
          : labelProblem(record.labels, job.arm, buckets.length);
    if (problem) {
      batches.get(bKey).problems.push(`${where}: the judgment ${problem}`);
      return;
    }
    if (!row.bySeat.has(job.seat)) row.bySeat.set(job.seat, new Map());
    row.bySeat.get(job.seat).set(job.arm, record.labels);
  });
  return [...batches.values()].map((entry) => ({
    skill: entry.skill,
    batch: entry.batch,
    problems: entry.problems,
    tasks: entry.tasks.map((row) => {
      // A seat counts only with a valid judgment for both arms, as in judge-scale.js aggregateTask.
      const countedSeats = [...row.bySeat]
        .filter(([, byArm]) => ARMS.every((arm) => byArm.has(arm)))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const base = { task_id: row.task_id, buckets: row.buckets };
      if (row.blocked)
        return {
          ...base,
          counted: false,
          invalid: row.blocked,
          seats: 0,
          judgments: [],
        };
      if (countedSeats.length < MIN_SEATS)
        return {
          ...base,
          counted: false,
          invalid: `${countedSeats.length} valid seat(s), need ${MIN_SEATS}`,
          seats: countedSeats.length,
          judgments: [],
        };
      return {
        ...base,
        counted: true,
        invalid: null,
        seats: countedSeats.length,
        judgments: countedSeats.map(([seat, byArm]) => ({
          seat,
          labels: { with: byArm.get('with'), without: byArm.get('without') },
        })),
      };
    }),
  }));
}

const emptyTally = () => ({ met: 0, partial: 0, missing: 0, n: 0 });
/** Counts one label of LABELS; buildBatchEntry checks every label first, so the last branch is MISSING. */
function addLabel(tally, label) {
  tally.n += 1;
  if (label === 'MET') tally.met += 1;
  else if (label === 'PARTIAL') tally.partial += 1;
  else tally.missing += 1;
}
const exactRate = (tally) => (tally.n ? tally.met / tally.n : null);
const withRate = (tally) => ({ ...tally, met_rate: round4(exactRate(tally)) });
const emptyBucketTallies = () =>
  Object.fromEntries(
    BUCKETS.map((bucket) => [
      bucket,
      Object.fromEntries(ARMS.map((arm) => [arm, emptyTally()])),
    ]),
  );

/** The per-task gap of one bucket over the tasks that have a rate in both arms, rounded to 4 places. */
function bucketGap(taskTallies, bucket) {
  const rows = [];
  for (const { task_id, tally } of taskTallies) {
    const withExact = exactRate(tally[bucket].with);
    const withoutExact = exactRate(tally[bucket].without);
    if (withExact !== null && withoutExact !== null)
      rows.push({ task_id, gap: withExact - withoutExact });
  }
  const result = gapStats(rows.map((row) => row.gap));
  return {
    tasks: result.tasks,
    mean_gap: round4(result.mean_gap),
    t_interval: result.t_interval && result.t_interval.map(round4),
    bootstrap_interval:
      result.bootstrap_interval && result.bootstrap_interval.map(round4),
    // Unrounded, for a reader that compares the interval with 0: a lower end of 0.00004 is above 0 though it prints
    // as 0.
    t_interval_exact: result.t_interval,
    per_task: rows.map((row) => ({
      task_id: row.task_id,
      gap: round4(row.gap),
    })),
  };
}

/**
 * The guard reading of one batch from its bucket tallies and guard gap. `data` is false when no counted task has a
 * guard item; then every figure is null and `note` is "no guard data".
 */
function guardReading(guardTallies, guardItems, guardGap, tasksCounted) {
  if (!guardItems) {
    return {
      data: false,
      note: NO_GUARD_DATA,
      reason: tasksCounted
        ? 'the checklists have no guard item (the skill has no generic rule)'
        : 'no task counted',
      items: 0,
      with_rate: null,
      without_rate: null,
      loss: null,
      gap: null,
    };
  }
  const withExact = exactRate(guardTallies.with);
  const withoutExact = exactRate(guardTallies.without);
  return {
    data: true,
    note: null,
    reason: null,
    items: guardItems,
    with_rate: round4(withExact),
    without_rate: round4(withoutExact),
    // Decided on the exact rates, not the rounded ones shown, so two rates that print the same can still be a loss.
    loss: withExact < withoutExact,
    gap: guardGap,
  };
}

/**
 * The report entry of one batch from collectBatches output ({ skill, batch, tasks, problems }). Pure.
 * Returns { skill, batch, tasks, tasks_counted, not_counted, problems, buckets, per_task, guard } where
 *   buckets[bucket] = { items, with: tally, without: tally }   tally = { met, partial, missing, n, met_rate }
 *   per_task[bucket] = { tasks, mean_gap, t_interval, bootstrap_interval, t_interval_exact, per_task }
 *   guard = guardReading(...)
 * `items` counts the checklist items of the bucket over the counted tasks. Throws a TypeError for a counted task
 * with no bucket list, an unknown bucket, or a judgment whose labels do not fit the list (as collectBatches checks).
 */
function buildBatchEntry({ skill, batch, tasks, problems = [] }) {
  if (!Array.isArray(tasks)) throw new TypeError('tasks must be an array');
  const tallies = emptyBucketTallies();
  const items = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
  const taskTallies = [];
  const notCounted = [];
  for (const task of tasks) {
    if (!task.counted) {
      notCounted.push({ task_id: task.task_id, invalid: task.invalid });
      continue;
    }
    const where = `${skill}/${batch}/${task.task_id}`;
    if (!Array.isArray(task.buckets))
      throw new TypeError(`${where}: a counted task needs its bucket list`);
    if (!Array.isArray(task.judgments))
      throw new TypeError(`${where}: a counted task needs its judgments`);
    task.judgments.forEach((judgment, judgmentIndex) =>
      ARMS.forEach((arm) => {
        const problem = labelProblem(
          judgment && judgment.labels && judgment.labels[arm],
          arm,
          task.buckets.length,
        );
        if (problem)
          throw new TypeError(
            `${where}: judgments[${judgmentIndex}] ${problem}`,
          );
      }),
    );
    const taskTally = emptyBucketTallies();
    taskTallies.push({ task_id: task.task_id, tally: taskTally });
    task.buckets.forEach((bucket, index) => {
      if (!BUCKETS.includes(bucket))
        throw new TypeError(
          `${where}: item ${index + 1} has the unknown bucket "${bucket}"`,
        );
      items[bucket] += 1;
      for (const judgment of task.judgments)
        for (const arm of ARMS) {
          addLabel(tallies[bucket][arm], judgment.labels[arm][index]);
          addLabel(taskTally[bucket][arm], judgment.labels[arm][index]);
        }
    });
  }
  const perTask = Object.fromEntries(
    BUCKETS.map((bucket) => [bucket, bucketGap(taskTallies, bucket)]),
  );
  return {
    skill,
    batch,
    tasks: tasks.length,
    tasks_counted: taskTallies.length,
    not_counted: notCounted,
    problems: [...problems],
    buckets: Object.fromEntries(
      BUCKETS.map((bucket) => [
        bucket,
        {
          items: items[bucket],
          with: withRate(tallies[bucket].with),
          without: withRate(tallies[bucket].without),
        },
      ]),
    ),
    per_task: perTask,
    guard: guardReading(
      tallies[GUARD_BUCKET],
      items[GUARD_BUCKET],
      perTask[GUARD_BUCKET],
      taskTallies.length,
    ),
  };
}

/**
 * The whole guard report from collectBatches output. Pure. Returns
 *   { version, definitions, skills: { [skill]: { batches: { [batch]: entry } } }, loss: [{ skill, batch }] }
 * with the skills and batches in key order: input order, except that a name that is a whole number (a batch `9`)
 * comes first, in numeric order, as for any object. `loss` lists every batch whose guard reading has `loss: true`.
 */
function buildGuardReport(batches) {
  if (!Array.isArray(batches)) throw new TypeError('batches must be an array');
  const skills = {};
  const loss = [];
  for (const input of batches) {
    const entry = buildBatchEntry(input);
    if (!Object.hasOwn(skills, entry.skill))
      skills[entry.skill] = { batches: {} };
    if (Object.hasOwn(skills[entry.skill].batches, entry.batch))
      throw new TypeError(
        `${entry.skill}/${entry.batch} appears twice in the report input`,
      );
    skills[entry.skill].batches[entry.batch] = entry;
    if (entry.guard.loss) loss.push({ skill: entry.skill, batch: entry.batch });
  }
  return {
    version: GUARD_REPORT_VERSION,
    definitions: { ...DEFINITIONS },
    skills,
    loss,
  };
}

module.exports = {
  GUARD_REPORT_VERSION,
  GUARD_BUCKET,
  NO_GUARD_DATA,
  DEFINITIONS,
  collectBatches,
  buildBatchEntry,
  buildGuardReport,
};
