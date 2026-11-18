// SPDX-License-Identifier: Apache-2.0
/**
 * The checklist job: writes the request-only checklist of reading A for every task of the selected skills that has
 * no current one. PAID: each checklist is one writer call through OpenCode on Bedrock (opencode.js judgeCall), plus
 * retries and at most one repair call. The rules of one call, its reply and its file are request-checklist.js's.
 *
 * Order of work:
 *   1. For the skills (not dose ladder items), `plan` for the same skills (plan.js) must pass: an invalid baseline, a
 *      projected cost above max_usd or a ledger past a limit refuses the job before anything is spent. Only skills
 *      `plan` plans (ready, rules stale, tasks stale) are written; the others are listed as skipped. Reading A needs
 *      only the tasks, so a skill whose rules or tasks are stale still gets its checklists.
 *   2. The tasks come from each skill's baseline (scale-view.js baselineSets) and, for a dose ladder item, from the
 *      ladder (dose-ladder.js), which must pass its audit. The ladder's doses share their tasks, so every dose after
 *      the first is a copy.
 *   3. A task a person has excluded from reading A (bench/exclusions.json, exclusions.js) is not planned: the writer
 *      is never called for it, no file is written, and it is counted in no total. It is listed with its reason. A file
 *      that is not valid refuses the job, whether `plan` or this job reads it first.
 *   4. A request that cannot be given to the writer (it still names the skill once stripped, or its rules checklist
 *      has fewer than 5 or more than 8 items) refuses the whole job: nothing is spent.
 *   5. The projection (one call per pending checklist at the upper estimate, the p90, of the writer model in the cost
 *      profile) must fit under max_usd with what the run has already spent or reserved. The ledger also refuses each
 *      call that would pass a limit.
 *   6. Fresh credentials are exported once for the configured profile (aws-credentials.js), and every call checks
 *      they are more than 3 minutes from expiry before it starts.
 *
 * Results. `done` when every task has a current checklist. `partial` when a task failed or the provider blocked
 * the writer on it: the run names those tasks, and a blocked task stays a failure of the run until a person records
 * it in bench/exclusions.json. `stopped` for a credential problem, a spend stop, a ledger that cannot be used, or 4
 * tasks in a row whose every call failed (systemic); finished checklists are kept and a rerun resumes.
 * `cut_off` counts the tries whose reply reached the output limit and could not be used (request-checklist.js
 * writeChecklists); a count above 0 is logged with the two settings that set the limit.
 */
'use strict';

const awsCredentials = require('./aws-credentials');
const { CredentialError } = awsCredentials;
const { rubricWriterModel } = require('./config');
const { assembleLadder, itemNames, validateLadder } = require('./dose-ladder');
const { loadExclusions, splitTasks } = require('./exclusions');
const { FormatError } = require('./formats');
const { estimatedCallsLine, trackEstimatedCalls } = require('./jobs');
const {
  createLedger,
  readLedger,
  LedgerError,
  SpendStopError,
} = require('./ledger');
const opencode = require('./opencode');
const { buildPlan } = require('./plan');
// The statuses `plan` counts calls for: the checklist job writes for the same skills the pairs job runs. A test
// checks this set against `plan` for every status it reports.
const { RUNNABLE_STATUSES } = require('./pairs');
const { createRedactor, redact } = require('./redact');
const { CallError, SystemicFailureError } = require('./retry');
const checklists = require('./request-checklist');
const { baselineSets } = require('./scale-view');

/** Writer calls of one job that may run at once. There is no setting for it; the judge seats have their own. */
const CHECKLIST_CONCURRENCY = 4;
const STOP_MESSAGE_CHARS = 400;
const LISTED_PROBLEMS = 10;

/**
 * The stop a thrown error means, or null for an error that is not a stop (a bug, which is thrown on). `redactor` is
 * the run's own redactor once it exists, so a stop message cannot quote a value only the run knows.
 */
function stopFor(error, redactor = redact) {
  const message = redactor(String(error && error.message), {
    maxChars: STOP_MESSAGE_CHARS,
  });
  if (
    error instanceof CredentialError ||
    (error instanceof CallError && error.kind === 'credential')
  )
    return { kind: 'credentials', message };
  if (error instanceof SpendStopError) return { kind: 'spend', message };
  if (error instanceof LedgerError) return { kind: 'ledger', message };
  if (error instanceof SystemicFailureError)
    return { kind: 'systemic', message };
  return null;
}

/** The default credential source: a fresh `aws configure export-credentials` for the configured profile. */
const exportForConfig = (config) =>
  awsCredentials.exportCredentials({
    profile: awsCredentials.resolveProfile(config),
    region: config.aws_region,
  });

/** The checklist sets of the dose ladder items in `items`: one per item, the ladder's tasks, no rule ids. */
function ladderSets(ladder, items) {
  const assembled = assembleLadder(ladder);
  return items.map((item) => ({
    skill: item,
    batch: assembled.set,
    tasks: assembled.items[item].tasks.map((task) => ({
      id: task.id,
      prompt: task.prompt,
      rubric: task.rubric,
    })),
    ruleIds: [],
  }));
}

/**
 * USD the run has spent or reserved so far, from the ledger. A reservation that expires moves from `reserved` to
 * `spent`, so the sum does not depend on the clock. Throws LedgerError for a ledger that cannot be read.
 */
function runUsdSoFar(layout) {
  const totals = readLedger(layout.ledgerFile).runs.get(layout.runId);
  return totals ? totals.spent + totals.reserved : 0;
}

const jobLabel = (job) => `${job.skill}/${job.batch}/${job.task_id}`;
const roundUsd = (usd) => Number(Number(usd || 0).toFixed(4));

/** Copies the writer's { written, copied, failed, refused, usd, cut_off } (a full run or the part before a stop) into the summary. */
function keepResults(summary, written) {
  const named = ({ task_id: task, reason }) => ({ task, reason });
  summary.usd = roundUsd(written.usd);
  summary.cut_off = written.cut_off;
  summary.results = {
    written: written.written,
    copied: written.copied,
    failed: written.failed.map(named),
    blocked: written.refused.map(named),
  };
}

/**
 * Runs the checklist job. Options:
 *   layout, config   createLayout(...) and loadConfig(...)
 *   skills           the selected skill names and dose ladder item names (already checked to exist)
 *   ladder           the dose ladder (an object or a file path) the item names come from, or null
 *   dryRun           list the pending checklists and stop; nothing is spent or written
 *   log              (line) => void, one line per event (default: nothing)
 *   judgeCall        the call (default opencode.js judgeCall); tests pass a stub
 *   getCredentials   async (config) => credentials (default: export for the configured profile)
 *   now              () => ms, for the expiry check and the file times
 *   writer           extra options for request-checklist.js writeChecklists (tests: sleep, delayMs)
 *
 * Returns { status, refused, stop, skipped, excluded, writer_model, tasks, done, pending, copies, projected_usd,
 * worst_case_usd, results, cut_off, remaining, warnings, usd, estimated } where status is
 *   refused   nothing was spent: `plan` refused the skills, a request cannot be given to the writer, the ladder
 *             fails its audit (a direct call; the launcher and job.js refuse such a ladder first, as a usage error),
 *             or the projection is above max_usd (refused lists why)
 *   dry-run   the pending checklists were listed
 *   done      every task has a current checklist
 *   partial   a task failed, or the provider blocked the writer on it (results.failed, results.blocked)
 *   stopped   a stop ended the job (`stop`: { kind, message }, kind credentials, spend, ledger or systemic)
 * and results is { written, copied, failed, blocked }: task labels written and copied, and { task, reason } for each
 * task that failed or was blocked. `cut_off` is the number of tries whose reply reached the output limit and could not
 * be used. `remaining` is the count of tasks still without a current checklist. `estimated`
 * is null, or { calls, models } for the calls charged at their mean because the CLI reported no usable cost
 * (jobs.js trackEstimatedCalls).
 */
async function runChecklists({
  layout,
  config,
  skills,
  ladder = null,
  dryRun = false,
  log = () => {},
  judgeCall = opencode.judgeCall,
  getCredentials = exportForConfig,
  now = Date.now,
  writer = {},
}) {
  const summary = {
    status: 'refused',
    refused: [],
    stop: null,
    skipped: [],
    excluded: [],
    writer_model: null,
    tasks: 0,
    done: 0,
    pending: 0,
    copies: 0,
    projected_usd: 0,
    worst_case_usd: 0,
    results: { written: [], copied: [], failed: [], blocked: [] },
    cut_off: 0,
    remaining: 0,
    warnings: [],
    usd: 0,
    estimated: null,
  };
  const ladderItems = ladder ? itemNames(ladder) : [];
  const ladderSelected = skills.filter((name) => ladderItems.includes(name));
  const realSkills = skills.filter((name) => !ladderItems.includes(name));

  let runnable = [];
  if (realSkills.length) {
    const plan = buildPlan({ layout, config, skills: realSkills });
    summary.warnings.push(...plan.warnings);
    if (!plan.ok) {
      summary.refused.push(...plan.refused);
      return summary;
    }
    runnable = plan.skills.filter((row) => {
      if (RUNNABLE_STATUSES.has(row.status)) return true;
      summary.skipped.push({ skill: row.skill, status: row.status });
      return false;
    });
  }
  if (ladderSelected.length) {
    const audit = validateLadder(ladder);
    if (!audit.ok) {
      summary.refused.push(
        `the dose ladder fails its audit: ${audit.problems.slice(0, LISTED_PROBLEMS).join('; ')}`,
      );
      return summary;
    }
  }

  const model = rubricWriterModel(config);
  summary.writer_model = model;
  let exclusions;
  try {
    exclusions = loadExclusions(layout);
  } catch (error) {
    // `plan` reports a malformed file for real skills; a run of ladder items alone skips `plan`, so refuse here.
    if (!(error instanceof FormatError)) throw error;
    summary.refused.push(error.message);
    return summary;
  }
  const sets = [
    ...baselineSets(
      layout,
      runnable.map((row) => row.skill),
    ),
    ...(ladderSelected.length ? ladderSets(ladder, ladderSelected) : []),
  ].map((set) => {
    const { kept, excluded } = splitTasks(exclusions, set.batch, set.tasks);
    summary.excluded.push(
      ...excluded.map((record) => ({ skill: set.skill, ...record })),
    );
    return { ...set, tasks: kept };
  });

  const planFor = () =>
    checklists.planChecklists({ sets, layout, model, config });
  const jobs = planFor();
  const projection = checklists.projection(jobs);
  Object.assign(summary, {
    tasks: projection.total,
    done: projection.done,
    pending: projection.pending,
    copies: projection.copies,
    projected_usd: projection.projected_usd,
    worst_case_usd: projection.worst_case_usd,
    remaining: checklists.remainingOf(jobs),
  });
  log(
    `checklists: skills ${[...runnable.map((row) => row.skill), ...ladderSelected].join(', ') || 'none'}; writer ${model}; ${projection.done}/${projection.total} checklist(s) current, ${projection.pending} call(s) pending${projection.copies ? ` (+${projection.copies} copied from a call with the same request)` : ''} (up to ${projection.max_calls} with retries and one repair each); projected USD ${projection.projected_usd.toFixed(2)}, worst case USD ${projection.worst_case_usd.toFixed(2)}; the writer sees the request text and the item count only`,
  );
  for (const { skill, status } of summary.skipped)
    log(`  skipped ${skill} (${status})`);
  for (const record of summary.excluded)
    log(
      `  ${record.skill}/${record.batch}/${record.id}: excluded from reading A (bench/exclusions.json, ${record.date}); no checklist is written: ${record.reason}`,
    );

  const blocked = jobs.filter((job) => job.state === 'blocked');
  if (blocked.length) {
    summary.refused.push(
      `${blocked.length} request(s) cannot be given to the checklist writer; no call was made`,
      ...blocked
        .slice(0, LISTED_PROBLEMS)
        .map((job) => `${jobLabel(job)}: ${job.problem}`),
    );
    return summary;
  }
  if (dryRun) {
    for (const job of jobs)
      if (job.state === 'pending')
        log(
          `  would write ${jobLabel(job)} (${job.input.item_count} items, about USD ${job.est.usd.toFixed(4)})`,
        );
      else if (job.state === 'copy')
        log(`  would copy ${jobLabel(job)} from ${job.copy_of}`);
    summary.status = 'dry-run';
    return summary;
  }
  if (!summary.remaining) {
    summary.status = 'done';
    return summary;
  }

  // The calls charged at their mean because the CLI reported no usable cost; none before the ledger exists.
  let estimatedCalls = () => null;
  // The run redactor exists once the credentials are exported; a stop before that is cleaned by the module redactor.
  let runRedactor = redact;
  const finish = () => {
    summary.estimated = estimatedCalls();
    if (summary.estimated)
      log(`checklists: ${estimatedCallsLine(summary.estimated)}`);
    if (summary.cut_off)
      log(
        `checklists: ${summary.cut_off} reply(ies) cut off at the output limit and not used; raise judge_max_output_tokens, or the seat's entry in judge_max_output_tokens_by_seat, if this keeps happening`,
      );
    summary.remaining = checklists.remainingOf(planFor());
    // A failed or blocked task has no file, so `remaining` already counts it.
    summary.status = summary.stop
      ? 'stopped'
      : summary.remaining
        ? 'partial'
        : 'done';
    return summary;
  };
  try {
    const spentSoFar = runUsdSoFar(layout);
    if (spentSoFar + projection.projected_usd > config.max_usd) {
      summary.refused.push(
        `the projected USD ${projection.projected_usd.toFixed(2)} on top of USD ${spentSoFar.toFixed(2)} already spent or reserved in run ${layout.runId} is above max_usd ${config.max_usd}; raise it to approve, or select fewer skills`,
      );
      return summary;
    }
    const credentials = await getCredentials(config);
    awsCredentials.assertFresh(credentials, {
      now,
      label: 'the checklist job',
    });
    const credentialGuard = {
      assertFresh: (label) =>
        awsCredentials.assertFresh(credentials, { now, label }),
    };
    // The exported secret key and session token have no secret shape the module redactor knows, so the ledger gets a
    // redactor that removes these exact values too.
    runRedactor = createRedactor({
      literals: opencode.exportedSecrets(credentials),
    });
    const tracker = trackEstimatedCalls(
      createLedger({
        file: layout.ledgerFile,
        limits: {
          max_usd: config.max_usd,
          total_cap_usd: config.total_cap_usd,
        },
        runId: layout.runId,
        redact: runRedactor,
      }),
    );
    estimatedCalls = tracker.estimated;
    const { ledger } = tracker;
    const call = checklists.createWriterCall({
      judgeCall,
      ledger,
      config,
      model,
      credentialGuard,
      credentials,
    });
    const written = await checklists.writeChecklists({
      jobs,
      call,
      model,
      concurrency: CHECKLIST_CONCURRENCY,
      log: (line) => log(`  ${line}`),
      now: () => new Date(now()),
      nameOf: jobLabel,
      redact: runRedactor,
      ...writer,
    });
    keepResults(summary, written);
    for (const { task } of summary.results.blocked)
      summary.warnings.push(
        `${task}: the provider blocked the checklist writer on every try; a person records it in bench/exclusions.json (reason and date) to leave it out of reading A`,
      );
  } catch (error) {
    const stop = stopFor(error, runRedactor);
    if (!stop) throw error;
    summary.stop = stop;
    // The calls made before the stop were paid: the job's spend and results must still say so.
    if (error.partial) keepResults(summary, error.partial);
  }
  return finish();
}

module.exports = {
  CHECKLIST_CONCURRENCY,
  RUNNABLE_STATUSES,
  stopFor,
  ladderSets,
  runChecklists,
};
