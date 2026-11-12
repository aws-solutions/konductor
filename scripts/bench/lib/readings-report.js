// SPDX-License-Identifier: Apache-2.0
/**
 * The readings report: for each skill (or dose ladder item), reading A and reading B of the SAME stored answer
 * pairs, each a mean task gap with a 95% t interval. Offline: it reads stored judgments and makes no call.
 *
 *   A  `outcome` scale   the request-only checklist (request-checklist.js)   -> mean gap, 95% t interval
 *   B  `items` scale     the task's rules checklist from the baseline         -> mean gap, 95% t interval
 * plus the mean answer length ratio (with / without), so a length bias is visible.
 *
 * Units. The independent unit is the task. A task's gap is the one reading B and reading A already use
 * (judge-job.js taskGaps, judge-scale.js aggregateTask): the mean over the counted seats of (score with) minus
 * (score without) on the 1 to 5 scale. Each answer is judged on its own, so a seat has one judgment per arm. A task
 * counts when at least MIN_SEATS seats gave a valid judgment for both arms and no answer is not loaded or not
 * eligible. The interval is a 95% t interval over the counted
 * tasks (df = n - 1, gap-stats.js), pooled over the skill's batches; each batch is also read on its own.
 *
 * Which judgments count. Only the judgments the judge job counts as current: a job is `done` only when the
 * judgment on disk was made from today's inputs (the answers, the checklist, the judge prompt and model, the
 * sanitizer). A judgment file that is not current leaves its job pending and is counted as stale, never read.
 *
 * Exclusions (exclusions.js). A task a person has left out of reading A has no `outcome` job, so A never reads it.
 * B is never excluded, but its main number is read over the tasks A can read, so the two readings compare like for
 * like; `B_all` is B over every task of the skill. With no exclusion `B_all` equals B.
 */
'use strict';

const fs = require('fs');

const { round4, gapStats } = require('./gap-stats');
const { taskGaps } = require('./judge-job');
const { ARMS } = require('./layout');

const READINGS_REPORT_VERSION = 1;
const READING_SCALES = Object.freeze({ A: 'outcome', B: 'items' });
/** The job states planJudging gives, in the order the coverage counts list them. */
const JOB_STATES = Object.freeze([
  'done',
  'pending',
  'waiting',
  'not_loaded',
  'ineligible',
  'other_arm_unusable',
]);

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const taskKey = (batch, taskId) => `${batch}\u0000${taskId}`;
const wordCount = (text) => (String(text ?? '').match(/\S+/g) || []).length;
/** A pending job whose judgment file is on disk: the judgment was made from other inputs, so it is stale. */
const fileIsStale = (job) =>
  job.state === 'pending' &&
  typeof job.file === 'string' &&
  fs.existsSync(job.file);

/** The gap statistics of `gaps`, rounded to 4 places, with the unrounded t interval for a reader comparing it to 0. */
function summarizeGaps(gaps) {
  const result = gapStats(gaps);
  return {
    tasks_counted: result.tasks,
    mean_gap: round4(result.mean_gap),
    t_interval: result.t_interval && result.t_interval.map(round4),
    bootstrap_interval:
      result.bootstrap_interval && result.bootstrap_interval.map(round4),
    // A lower end of 0.00004 is above 0 though it prints as 0, so the rules read this one.
    t_interval_exact: result.t_interval,
  };
}

/**
 * How many judge jobs of the reading are in each state, plus the pending ones whose file is stale. The state counts
 * add up to `expected`; a job in a state not in JOB_STATES is refused, not left out.
 */
function coverageOf(jobs, isStale) {
  const counts = Object.fromEntries(JOB_STATES.map((state) => [state, 0]));
  let stale = 0;
  for (const job of jobs) {
    if (!Object.hasOwn(counts, job.state))
      throw new TypeError(
        `unknown judge job state ${JSON.stringify(job.state)}; known states are ${JOB_STATES.join(', ')}`,
      );
    counts[job.state] += 1;
    if (isStale(job)) stale += 1;
  }
  return { expected: jobs.length, ...counts, stale };
}

/**
 * One reading of one skill from its judge jobs of one scale (judge-job.js planJudging). Options:
 *   scale          'items' (B) or 'outcome' (A); every job must be of this scale
 *   readRecord     reads a done job's record (default: its judgment file, as taskGaps reads it)
 *   isStale        true for a job whose judgment on disk is not current (default: a pending job whose file exists)
 * Returns { scale, tasks, tasks_counted, mean_gap, t_interval, bootstrap_interval, t_interval_exact, per_task,
 * not_counted, by_batch, judgments } where per_task lists every task in job order ({ batch, task_id, counted, gap,
 * seats_valid, invalid }) and by_batch holds the same statistics for each batch alone.
 */
function readingOf(jobs, { scale, readRecord, isStale = fileIsStale } = {}) {
  if (!Object.values(READING_SCALES).includes(scale))
    throw new TypeError(
      `scale must be one of ${Object.values(READING_SCALES).join(', ')}`,
    );
  if (!Array.isArray(jobs)) throw new TypeError('jobs must be an array');
  jobs.forEach((job, index) => {
    if (!isPlainObject(job) || !isPlainObject(job.task))
      throw new TypeError(`jobs[${index}] must be a judge job`);
    if (job.scale !== scale)
      throw new TypeError(
        `jobs[${index}] is a ${job.scale} job; this reading reads ${scale} judgments only`,
      );
  });
  const rows = taskGaps(jobs, readRecord ? { readRecord } : {});
  const perTask = rows.map((row) => ({
    batch: row.batch,
    task_id: row.task_id,
    counted: row.counted,
    gap: row.counted ? round4(row.gap) : null,
    seats_valid: row.seats_valid,
    invalid: row.invalid,
  }));
  const countedGaps = (list) =>
    list.filter((row) => row.counted).map((row) => row.gap);
  const batches = new Map();
  for (const row of rows) {
    if (!batches.has(row.batch)) batches.set(row.batch, []);
    batches.get(row.batch).push(row);
  }
  return {
    scale,
    tasks: rows.length,
    ...summarizeGaps(countedGaps(rows)),
    per_task: perTask,
    not_counted: perTask
      .filter((row) => !row.counted)
      .map((row) => ({
        batch: row.batch,
        task_id: row.task_id,
        invalid: row.invalid,
      })),
    by_batch: Object.fromEntries(
      [...batches].map(([batch, batchRows]) => [
        batch,
        { tasks: batchRows.length, ...summarizeGaps(countedGaps(batchRows)) },
      ]),
    ),
    judgments: coverageOf(jobs, isStale),
  };
}

/**
 * The mean of per-task with / without word counts, over the tasks whose without answer has words, and the ratio of
 * the mean word counts. `pairs` is [{ with, without }] of word counts.
 */
function lengthRatio(pairs) {
  if (!Array.isArray(pairs)) throw new TypeError('pairs must be an array');
  const ratios = pairs
    .filter((pair) => pair.without > 0)
    .map((pair) => pair.with / pair.without);
  const average = (values) =>
    values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  const withMean = average(pairs.map((pair) => pair.with));
  const withoutMean = average(pairs.map((pair) => pair.without));
  return {
    tasks: ratios.length,
    mean: round4(average(ratios)),
    ratio_of_means:
      withMean !== null && withoutMean ? round4(withMean / withoutMean) : null,
  };
}

/**
 * The word counts of each task's two stored answers. A judge job carries the one answer of its arm, so each arm's
 * count comes from the first job of that task and arm that carries it; a task with only one arm's answer has no
 * entry. The count is of the stored answer as written (`job.answer`), not of the text the judge was shown after the
 * judge input step (`job.shown`), so it measures how much each arm wrote.
 */
function answerWords(jobs) {
  const byTask = new Map();
  for (const job of jobs) {
    if (!ARMS.includes(job.arm) || !isPlainObject(job.answer)) continue;
    const key = taskKey(job.batch, job.task.id);
    if (!byTask.has(key))
      byTask.set(key, { batch: job.batch, task_id: job.task.id });
    const entry = byTask.get(key);
    if (!Object.hasOwn(entry, job.arm))
      entry[job.arm] = wordCount(job.answer.text);
  }
  return [...byTask.values()].filter((entry) =>
    ARMS.every((arm) => Object.hasOwn(entry, arm)),
  );
}

/**
 * Everything the report says about one skill (or dose ladder item). Offline and pure apart from `readRecord` and
 * `isStale`. Options:
 *   skill        the skill or item name
 *   itemsJobs    the `items` judge jobs of the run (planJudging scale `items`); other skills' jobs are ignored
 *   outcomeJobs  the `outcome` judge jobs (planJudging scale `outcome`); other skills' jobs are ignored
 *   excluded     the reading A exclusions planJudging lists ([{ skill, batch, id, reason, date }])
 *   readRecord, isStale   as for readingOf
 * Returns { skill, tasks, A, B, B_all, exclusions, length_ratio }, or { skill, error } when the run has no judge job
 * for the skill on either scale.
 */
function readSkill({
  skill,
  itemsJobs = [],
  outcomeJobs = [],
  excluded = [],
  readRecord,
  isStale,
}) {
  if (typeof skill !== 'string' || !skill)
    throw new TypeError('skill must be a name');
  for (const [name, list] of [
    ['itemsJobs', itemsJobs],
    ['outcomeJobs', outcomeJobs],
    ['excluded', excluded],
  ])
    if (!Array.isArray(list)) throw new TypeError(`${name} must be an array`);
  const ofSkill = (list) => list.filter((job) => job && job.skill === skill);
  const itemsOfSkill = ofSkill(itemsJobs);
  const outcomeOfSkill = ofSkill(outcomeJobs);
  if (!itemsOfSkill.length && !outcomeOfSkill.length)
    return { skill, error: `the run has no judge job for ${skill}` };
  const exclusions = excluded
    .filter((record) => record && record.skill === skill)
    .map(({ batch, id, reason, date }) => ({ batch, id, reason, date }));
  const left = new Set(
    exclusions.map((record) => taskKey(record.batch, record.id)),
  );
  const options = { readRecord, isStale };
  const itemsKept = itemsOfSkill.filter(
    (job) => !left.has(taskKey(job.batch, job.task.id)),
  );
  const readingB = readingOf(itemsKept, { ...options, scale: 'items' });
  const readingBAll =
    itemsKept.length === itemsOfSkill.length
      ? readingB
      : readingOf(itemsOfSkill, { ...options, scale: 'items' });
  const allTasks = new Set(
    [...itemsOfSkill, ...outcomeOfSkill].map((job) =>
      taskKey(job.batch, job.task.id),
    ),
  );
  for (const record of exclusions)
    allTasks.add(taskKey(record.batch, record.id));
  const words = answerWords([...itemsOfSkill, ...outcomeOfSkill]);
  return {
    skill,
    tasks: allTasks.size,
    A: readingOf(outcomeOfSkill, { ...options, scale: 'outcome' }),
    B: readingB,
    B_all: readingBAll,
    exclusions,
    length_ratio: {
      ...lengthRatio(words),
      per_task: words.map((entry) => ({
        batch: entry.batch,
        task_id: entry.task_id,
        ratio: entry.without > 0 ? round4(entry.with / entry.without) : null,
      })),
    },
  };
}

module.exports = {
  READINGS_REPORT_VERSION,
  READING_SCALES,
  wordCount,
  lengthRatio,
  readingOf,
  readSkill,
};
