// SPDX-License-Identifier: Apache-2.0
/**
 * The readings report: for each skill (or dose ladder item), reading A and reading B of the SAME stored answer
 * pairs, each a mean task gap with a 95% t interval. Offline: it reads stored judgments and makes no call.
 *
 *   A  `outcome` scale   the request-only checklist (request-checklist.js)   -> mean gap, 95% t interval
 *   B  `items` scale     the task's rules checklist from the baseline         -> mean gap, 95% t interval
 * plus the mean answer length ratio (with / without), so a length bias is visible. The ratio is over every task of
 * the skill that has both stored answers, whatever its state (an excluded task, or one that does not count, is in
 * it), so its `tasks` can be more than A's or B's count.
 *
 * Units. The independent unit is the task. A task's gap is the one reading B and reading A already use
 * (judge-job.js taskGaps, judge-scale.js aggregateTask): the mean over the counted seats of (score with) minus
 * (score without) on the 1 to 5 scale. Each answer is judged on its own, so a seat has one judgment per arm. A task
 * counts when at least MIN_SEATS seats gave a valid judgment for both arms and no answer is not loaded or not
 * eligible. The interval is a 95% t interval over the counted tasks (df = n - 1, gap-stats.js), pooled over the
 * skill's batches; each batch is also read on its own.
 *
 * Which judgments count. Only the judgments the judge job counts as current: a job is `done` only when the
 * judgment on disk was made from today's inputs (the answers, the checklist, the judge prompt and model, the
 * sanitizer). A judgment file that is not current leaves its job pending and is counted as stale, never read.
 *
 * Exclusions (exclusions.js). A task a person has left out of reading A has no `outcome` job, so A never reads it.
 * B is never excluded, but its main number is read over the tasks A can read, so the two readings compare like for
 * like; `B_all` is B over every task of the skill. With no exclusion `B_all` is the same object as B.
 *
 * The controls. A control is a case whose right answer is known in advance:
 * `convention-control` and the dose ladder. PASS_RULES below are their pass rules, evaluated on the same readings. A
 * control reading that does not count every task, or has a judgment pending or stale, is NOT RUN, and a run is
 * trusted only when every control it includes passes.
 */
'use strict';

const fs = require('fs');

const { itemName } = require('./dose-ladder');
const { round4, gapStats } = require('./gap-stats');
const { taskGaps } = require('./judge-job');
const { judgeFor } = require('./judge-prompt');
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

// ---- the pass rules ---------------------------------------------------------------------------------------------------

/**
 * THE PASS RULES of the controls, dated by PASS_RULES_DATE. The report prints this text and the code below
 * evaluates it. The text and the date change together: a test pins the text to the date.
 */
const PASS_RULES_DATE = '2026-11-18';
const PASS_RULES = [
  'Notation: "A" and "B" are the two readings above. "lower" and "upper" are the ends of a 95% t interval over the counted tasks of the control (df = n - 1). A gap is with minus without on the 1 to 5 scale.',
  '',
  "1. `convention-control` (a neutral skill of arbitrary, harmless conventions; no request names a rule). PASS if both: (a) B shows a gain: the lower end of B's gap is above 0 (the model followed the conventions); (b) A's interval contains 0 (a checklist written from the request alone does not reward them).",
  "2. Dose ladder D0, D1, D2, D4 (authored answers with more planted flaws at each dose, items `fixture-d0` to `fixture-d4`, read by A). PASS if all of: (a) D4 has the lowest mean gap of the four doses; (b) D0's interval contains 0; (c) the mean gap does not rise from D1 to D2 to D4, and D4 is below D1.",
  '3. A control reading that cannot decide is NOT RUN, not a pass or a fail: a reading with fewer than 2 counted tasks (so no interval), a reading that does not count every task of the control, and a reading with any judgment that is pending, waiting or stale. Rules 1 and 2 read only complete readings, so a control judged on some of its tasks cannot pass.',
  '4. A run is trusted only when every control it includes passes. A run that includes no control is not trusted.',
].join('\n');

const CONVENTION_CONTROL = 'convention-control';
const LADDER_CONTROL = 'ladder';
const NOT_RUN = 'NOT RUN';

const formatGap = (value) =>
  typeof value === 'number'
    ? `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
    : 'n/a';
const formatInterval = (interval) =>
  interval ? `[${formatGap(interval[0])}, ${formatGap(interval[1])}]` : 'n/a';
const describe = (label, reading) =>
  `${label} gap ${formatGap(reading.mean_gap)} ${formatInterval(reading.t_interval)}`;

/** True when the interval holds `point` (ends included). */
const intervalContains = (interval, point) =>
  Array.isArray(interval) && interval[0] <= point && point <= interval[1];

const check = (name, ok, detail) => ({ name, ok, detail });
function verdict(control, checks, missing) {
  if (missing.length)
    return { control, status: NOT_RUN, pass: null, checks, missing };
  const pass = checks.every((entry) => entry.ok);
  return { control, status: pass ? 'PASS' : 'FAIL', pass, checks, missing };
}
/**
 * Why a reading cannot decide a control (rule 3), as lines: no interval (fewer than 2 counted tasks), or a reading that
 * does not count every task or has a judgment that is not done. A shorter interval from half the tasks would pass
 * rule 1(b) more easily, so a control is read only when it is complete.
 */
function missingInterval(label, reading, scale) {
  if (!reading.t_interval_exact)
    return [
      `${label} has fewer than 2 counted tasks with ${scale} judgments (${reading.tasks_counted} of ${reading.tasks})`,
    ];
  const { judgments } = reading;
  const lines = [];
  if (reading.tasks_counted !== reading.tasks)
    lines.push(
      `${label} counts ${reading.tasks_counted} of ${reading.tasks} tasks with ${scale} judgments, and a control is read only when every task counts`,
    );
  if (judgments.done !== judgments.expected)
    lines.push(
      `${label} has ${judgments.expected - judgments.done} of ${judgments.expected} ${scale} judgments that are not done (${judgments.pending} pending, ${judgments.stale} of them stale, ${judgments.waiting} waiting)`,
    );
  return lines;
}

/** Rule 1. `summary` is readSkill's result for convention-control. */
function evaluateConventionControl(summary) {
  if (!summary || summary.error)
    return verdict(
      CONVENTION_CONTROL,
      [],
      [
        summary && summary.error
          ? summary.error
          : `${CONVENTION_CONTROL} is not in the run`,
      ],
    );
  const missing = [
    ...missingInterval('B', summary.B, 'items'),
    ...missingInterval('A', summary.A, 'outcome'),
  ];
  const lowerB = summary.B.t_interval_exact;
  const checks = [
    check(
      'B shows a gain: lower end above 0',
      !!lowerB && lowerB[0] > 0,
      describe('B', summary.B),
    ),
    check(
      'A interval contains 0',
      intervalContains(summary.A.t_interval_exact, 0),
      describe('A', summary.A),
    ),
  ];
  return verdict(CONVENTION_CONTROL, checks, missing);
}

/**
 * The dose ladder input of rule 2 from a ladder's `doses` ({ D0: 0, D1: 1, ... }, dose-ladder.js) and the readSkill
 * results of its items, keyed by item name (`fixture-d0`, ...). A dose with no result gets none, so rule 2 reads it
 * as not run. Returns [{ dose, n, skill, summary }] in dose order.
 */
function ladderDoses(doses, summaries) {
  if (!isPlainObject(doses)) throw new TypeError('doses must be an object');
  if (!isPlainObject(summaries))
    throw new TypeError('summaries must be an object keyed by item name');
  return Object.entries(doses)
    .map(([dose, count]) => {
      const skill = itemName(dose);
      return {
        dose,
        n: count,
        skill,
        summary: Object.hasOwn(summaries, skill) ? summaries[skill] : null,
      };
    })
    .sort((left, right) => left.n - right.n);
}

/**
 * Rule 2. `doses` is ladderDoses output (any order). The lowest dose must apply no defect (D0, the null test) and the
 * ladder needs at least two more doses. Each dose is read by A, its mean gap and its interval.
 */
function evaluateLadder(doses) {
  if (!Array.isArray(doses)) throw new TypeError('doses must be an array');
  const sorted = [...doses].sort((left, right) => left.n - right.n);
  const missing = [];
  for (const entry of sorted) {
    const summary = entry.summary;
    if (!summary || summary.error)
      missing.push(
        `${entry.dose}: ${summary && summary.error ? summary.error : 'not in the run'}`,
      );
    else
      missing.push(
        ...missingInterval('A', summary.A, 'outcome').map(
          (line) => `${entry.dose}: ${line}`,
        ),
      );
  }
  if (sorted.length < 3 || sorted[0].n !== 0)
    missing.push('the ladder needs D0 (no defect) and at least two more doses');
  if (missing.length) return verdict(LADDER_CONTROL, [], missing);
  const meanOf = (entry) => entry.summary.A.mean_gap;
  const top = sorted[sorted.length - 1];
  const zero = sorted[0];
  const nonZero = sorted.slice(1);
  const others = sorted.filter((entry) => entry !== top);
  const series = nonZero.map(meanOf);
  const neverRises = series
    .slice(1)
    .every((mean, index) => mean <= series[index]);
  const checks = [
    check(
      `A: ${top.dose} has the lowest mean gap`,
      others.every((entry) => meanOf(top) < meanOf(entry)),
      sorted
        .map((entry) => `${entry.dose} ${formatGap(meanOf(entry))}`)
        .join(', '),
    ),
    check(
      `A: ${zero.dose} interval contains 0`,
      intervalContains(zero.summary.A.t_interval_exact, 0),
      `${zero.dose} ${formatGap(meanOf(zero))} ${formatInterval(zero.summary.A.t_interval)}`,
    ),
    check(
      `A: mean gap does not rise from ${nonZero[0].dose} to ${top.dose}, and ${top.dose} is below ${nonZero[0].dose}`,
      neverRises && series[series.length - 1] < series[0],
      nonZero
        .map((entry) => `${entry.dose} ${formatGap(meanOf(entry))}`)
        .join(' -> '),
    ),
  ];
  return verdict(LADDER_CONTROL, checks, []);
}

/** A readSkill result: `{ skill, error }`, or a reading with A and B. */
const isSummary = (value) =>
  isPlainObject(value) &&
  (typeof value.error === 'string' ||
    (isPlainObject(value.A) && isPlainObject(value.B)));

/** Refuses a `ladder` that is not ladderDoses output: [{ dose, n, skill, summary }], summary null or a readSkill result. */
function checkLadder(ladder) {
  if (!Array.isArray(ladder))
    throw new TypeError(
      'ladder must be an array of { dose, n, skill, summary } (ladderDoses)',
    );
  ladder.forEach((entry, index) => {
    if (
      !isPlainObject(entry) ||
      typeof entry.dose !== 'string' ||
      !Number.isFinite(entry.n) ||
      typeof entry.skill !== 'string' ||
      (entry.summary !== null && !isSummary(entry.summary))
    )
      throw new TypeError(
        `ladder[${index}] must be { dose, n, skill, summary }, with summary null or a readSkill result`,
      );
  });
}

/**
 * The whole readings report. Pure when `generatedAt` is given (the clock is read otherwise). Options:
 *   skills       readSkill results of the skills measured (not the controls), in the order to show them
 *   convention   readSkill result of convention-control, or null when the run does not include it
 *   ladder       ladderDoses output, or null when the run does not include the ladder
 *   generatedAt  ISO time to print
 * Returns { version, generated_at, rules_date, rules, scales, prompt_versions, skills, controls, trusted,
 * controls_status } where controls_status is PASS (trusted), FAIL (a control failed or was not run) or NONE (no
 * control included, so not trusted either).
 */
function buildReadingsReport({
  skills = [],
  convention = null,
  ladder = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(skills)) throw new TypeError('skills must be an array');
  if (convention !== null && !isSummary(convention))
    throw new TypeError(
      'convention must be a readSkill result ({ skill, error } or a reading with A and B), or null',
    );
  if (ladder !== null) checkLadder(ladder);
  const controls = {};
  if (convention)
    controls[CONVENTION_CONTROL] = {
      rule: 1,
      summary: convention,
      evaluation: evaluateConventionControl(convention),
    };
  if (ladder)
    controls[LADDER_CONTROL] = {
      rule: 2,
      doses: ladder.map(({ dose, n, skill, summary }) => ({
        dose,
        n,
        skill,
        summary,
      })),
      evaluation: evaluateLadder(ladder),
    };
  const evaluations = Object.values(controls).map(
    (control) => control.evaluation,
  );
  const trusted =
    evaluations.length > 0 &&
    evaluations.every((evaluation) => evaluation.pass === true);
  return {
    version: READINGS_REPORT_VERSION,
    generated_at: generatedAt,
    rules_date: PASS_RULES_DATE,
    rules: PASS_RULES,
    scales: { ...READING_SCALES },
    prompt_versions: Object.fromEntries(
      Object.entries(READING_SCALES).map(([reading, scale]) => {
        const prompt = judgeFor(scale);
        return [reading, { version: prompt.version, sha256: prompt.sha256 }];
      }),
    ),
    skills: [...skills],
    controls,
    trusted,
    controls_status: trusted ? 'PASS' : evaluations.length ? 'FAIL' : 'NONE',
  };
}

module.exports = {
  READINGS_REPORT_VERSION,
  READING_SCALES,
  PASS_RULES_DATE,
  PASS_RULES,
  CONVENTION_CONTROL,
  LADDER_CONTROL,
  NOT_RUN,
  wordCount,
  lengthRatio,
  readingOf,
  readSkill,
  intervalContains,
  ladderDoses,
  evaluateConventionControl,
  evaluateLadder,
  buildReadingsReport,
};
