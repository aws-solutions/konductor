// SPDX-License-Identifier: Apache-2.0
/**
 * The driver's `next` command: what a run should do now, worked out from the baseline and the files on disk. It reads
 * no plan file and keeps no state of its own, so a rerun after a crash or a STOP starts at the first unfinished job.
 *
 * The jobs come in stage order (plan stages 2 and 3):
 *   pairs               the subject runs, with and without the skill
 *   judge --scale items      reading B, the rules checklist
 *   checklists          the request-only checklists of reading A
 *   judge --scale outcome    reading A
 * The first job with work to do is the answer. Each one's pending work is the job's own dry run (it builds nothing on
 * disk, spends nothing and writes nothing), so `next` and the job can never disagree about what is left.
 *
 * Before naming a job, `next` checks the limits:
 *   max_usd, total_cap_usd            `plan` for the same skills must pass: this run's spend so far plus every
 *                                      pending call within max_usd, and the ledger within total_cap_usd. Else `stop`.
 *   max_minutes                        given with the time the run started. No job starts once the limit is reached,
 *                                      or when the job's estimated time does not fit in what is left. Then `stop`.
 *                                      A start time more than a minute ahead of the clock is a usage error.
 *
 * The result is one of
 *   { next: 'job', job, scale?, stage, run_id, skills, pending, estimated_usd, estimated_minutes, command }
 *   { next: 'done', status: 'done' | 'partial', run_id, skills, not_loaded, ineligible, blocked }
 *   { next: 'stop', kind: 'spend' | 'time' | 'refused', reason, run_id, skills }
 * `command` is the argument list of the job in the foreground (`node scripts/bench/job.js ...`). `partial` means a
 * judgment is blocked by the provider: no job can finish it, and the report names it. `reason` is redacted and cut
 * to REASON_MAX_CHARS characters.
 *
 * A job that ends with work left (exit 3, partial) is named again by the next `next`: a failed call is tried again
 * on the next run. The loop that runs the jobs stops on a job's non-zero exit, so a failure that repeats costs one
 * try per rerun and not one per loop.
 */
'use strict';

const path = require('path');

const { runChecklists, CHECKLIST_CONCURRENCY } = require('./checklist-job');
const { UsageError } = require('./cli-args');
const { judgeConcurrency } = require('./config');
const { callCost } = require('./cost-profile');
const { runJudging } = require('./judge-job');
const { jobArguments } = require('./launch');
const { runPairs } = require('./pairs');
const { buildPlan } = require('./plan');
const { redact } = require('./redact');

const JOB_SCRIPT = path.join('scripts', 'bench', 'job.js');
/**
 * The longest `reason` of a stop line. An invalid baseline lists every problem it has, so the text has no bound of
 * its own, and the line must stay whole JSON for a loop that parses it.
 */
const REASON_MAX_CHARS = 2000;
/** How far after `now` --started-at may lie: a little clock difference between the host that starts the run and this one. */
const START_SKEW_MS = 60000;
/**
 * Minutes per wave of calls, for the time check only. A job is waves of calls (pending / concurrency); a wave takes
 * about as long as its slowest call. One minute a wave is an assumed upper bound for a judge or writer call (the
 * slowest seen took about 42 s; no timing file is kept in the repository), and the subject figure is a round 3 because a
 * real skill's task takes longer than the short control tasks.
 */
const MINUTES_PER_CALL = Object.freeze({ subject: 3, writer: 1, judge: 1 });

/** The jobs in the order a run makes them. */
const STEPS = Object.freeze([
  Object.freeze({ job: 'pairs', scale: null, stage: 2 }),
  Object.freeze({ job: 'judge', scale: 'items', stage: 2 }),
  Object.freeze({ job: 'checklists', scale: null, stage: 3 }),
  Object.freeze({ job: 'judge', scale: 'outcome', stage: 3 }),
]);

const waves = (calls, width) => Math.ceil(calls / Math.max(1, width));

/** The dry run of one step: { summary, pending, usd, minutes }. */
async function dryRunOf(step, { layout, config, skills, jobOptions }) {
  const common = { layout, config, skills, dryRun: true, log: () => {} };
  if (step.job === 'pairs') {
    const summary = await runPairs({ ...common, ...jobOptions.pairs });
    return {
      summary,
      pending: summary.pending,
      usd:
        summary.pending *
        callCost(config, 'subject', config.models.subject).p90,
      minutes:
        waves(summary.pending, config.subject_concurrency) *
        MINUTES_PER_CALL.subject,
    };
  }
  if (step.job === 'checklists') {
    const summary = await runChecklists({
      ...common,
      ...jobOptions.checklists,
    });
    return {
      summary,
      pending: summary.pending,
      usd: summary.projected_usd,
      minutes:
        waves(summary.pending, CHECKLIST_CONCURRENCY) * MINUTES_PER_CALL.writer,
    };
  }
  const summary = await runJudging({
    ...common,
    scale: step.scale,
    ...jobOptions.judge,
  });
  const seats = Object.keys(config.models.judges);
  const width = Math.min(
    ...seats.map((seat) => judgeConcurrency(config, seat)),
  );
  // Ineligible judgments are recorded without a call, but only the job records them, so they are work for it too.
  const pending = summary.pending + summary.ineligible;
  return {
    summary,
    pending,
    usd: summary.projected_usd,
    minutes:
      waves(summary.pending, seats.length * width) * MINUTES_PER_CALL.judge,
  };
}

/** The stop kind of a refused plan: spend when a limit refused it, else refused (a baseline, agent or ledger problem). */
function planStopKind(plan) {
  // within_total_cap is null when the ledger cannot be read; that refusal is not a spend stop.
  const ledgerOver = plan.within_total_cap === false;
  return !plan.within_max || ledgerOver ? 'spend' : 'refused';
}

const roundUsd = (usd) => Math.round(usd * 10000) / 10000;

/** The limit the dry runs use when `next` has already found a limit reached: they only count pending work. */
const UNLIMITED_USD = Number.MAX_SAFE_INTEGER;

/**
 * Works out the next step of a run. Options:
 *   layout, config, skills   as for the jobs (skills already checked to exist)
 *   provider                 'live' or 'stub', passed on to the job's command
 *   maxMinutes, startedAtMs  the time limit and when the run started (both or neither)
 *   now                      () => ms (tests)
 *   maxUsdText, configFile   the --max-usd and --config the job's command repeats
 *   jobOptions               { pairs, checklists, judge }: extra options for the dry runs (tests: armsTmpRoot)
 */
async function nextStep({
  layout,
  config,
  skills,
  provider = 'live',
  maxMinutes = null,
  startedAtMs = null,
  now = Date.now,
  maxUsdText,
  configFile,
  jobOptions = {},
}) {
  const head = { run_id: layout.runId, skills: [...skills].sort() };
  const stop = (kind, reason) => ({
    next: 'stop',
    kind,
    reason: redact(reason, { maxChars: REASON_MAX_CHARS }),
    ...head,
  });

  let minutesLeft = null;
  if (maxMinutes !== null) {
    // A start time ahead of the clock would count as extra minutes left and switch the limit off without a message.
    if (startedAtMs - now() > START_SKEW_MS)
      throw new UsageError(
        `--started-at ${new Date(startedAtMs).toISOString()} is in the future; give the time the run started`,
      );
    minutesLeft = maxMinutes - (now() - startedAtMs) / 60000;
  }

  const plan = buildPlan({ layout, config, skills });
  // A limit stops a job that has work to do. A run with nothing left is done, whatever it has spent or however long it
  // took, so a refusal for a limit waits until a job is pending, and the dry runs below ignore the limits.
  const spendRefusal = !plan.ok && planStopKind(plan) === 'spend';
  if (!plan.ok && !spendRefusal)
    return stop('refused', plan.refused.join('; '));

  const context = {
    layout,
    config: spendRefusal
      ? { ...config, max_usd: UNLIMITED_USD, total_cap_usd: UNLIMITED_USD }
      : config,
    skills: head.skills,
    jobOptions: {
      pairs: jobOptions.pairs || {},
      checklists: jobOptions.checklists || {},
      judge: jobOptions.judge || {},
    },
  };
  const totals = { not_loaded: 0, ineligible: 0, blocked: 0 };
  for (const step of STEPS) {
    const { summary, pending, usd, minutes } = await dryRunOf(step, context);
    if (summary.status === 'refused')
      return stop('refused', summary.refused.join('; '));
    if (step.job === 'judge') {
      totals.not_loaded += summary.not_loaded;
      totals.ineligible += summary.ineligible;
      totals.blocked += summary.blocked.length;
    }
    if (!pending) continue;
    if (minutesLeft !== null && minutesLeft <= 0)
      return stop(
        'time',
        `max_minutes ${maxMinutes} is reached; finished work is kept, rerun to continue`,
      );
    if (spendRefusal) return stop('spend', plan.refused.join('; '));
    if (minutesLeft !== null && minutes > minutesLeft)
      return stop(
        'time',
        `the next job (${step.job}${step.scale ? ` ${step.scale}` : ''}, ${pending} call(s)) needs about ${minutes} minute(s) and ${Math.max(0, Math.floor(minutesLeft))} of max_minutes ${maxMinutes} are left; ${
          // A job longer than the whole limit stops every rerun the same way, so rerunning is not the way on.
          minutes > maxMinutes
            ? 'finished work is kept, and this job needs more than max_minutes on its own, so raise max_minutes'
            : 'finished work is kept, rerun to continue'
        }`,
      );
    const request = {
      job: step.job,
      skills: head.skills,
      layout,
      maxUsdText,
      configFile,
      ladderFile: null,
      scale: step.scale,
      provider,
    };
    return {
      next: 'job',
      job: step.job,
      ...(step.scale ? { scale: step.scale } : {}),
      stage: step.stage,
      ...head,
      pending,
      estimated_usd: roundUsd(usd),
      estimated_minutes: minutes,
      command: [
        'node',
        JOB_SCRIPT,
        ...jobArguments(request, { dryRun: false }),
      ],
    };
  }
  return {
    next: 'done',
    status: totals.blocked ? 'partial' : 'done',
    ...head,
    ...totals,
  };
}

module.exports = {
  STEPS,
  MINUTES_PER_CALL,
  START_SKEW_MS,
  nextStep,
};
