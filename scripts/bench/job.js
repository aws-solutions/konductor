// SPDX-License-Identifier: Apache-2.0
/**
 * Runs one benchmark job in the foreground. The launcher (launch.js) starts this script detached, with its output
 * going to the job's log; it can also be run by hand.
 *
 *   node scripts/bench/job.js pairs --skills a,b [--run <id>] [--max-usd N] [--config <file>] [--root <dir>] [--dry-run]
 *   node scripts/bench/job.js checklists --skills a,b [--ladder <file>] [same options]
 *   node scripts/bench/job.js judge --scale items|outcome --skills a,b [same options]
 *
 * `pairs` makes the subject runs (lib/pairs.js), `checklists` the request-only checklists of reading A
 * (lib/checklist-job.js) and `judge` the judgments of one reading (lib/judge-job.js). Each SPENDS MONEY unless
 * --dry-run is given. The options are read and checked by the same function the launcher uses (lib/launch.js
 * parseJobCommand). The job prints one line per event, then a last line that is one JSON object:
 *   pairs        { job, run_id, skills, status, exit_code, stop, jobs, pending, results, skipped }
 *   checklists   { job, run_id, skills, status, exit_code, stop, tasks, done, pending, copies, remaining, excluded,
 *                  results, usd, skipped }
 *   judge        { job, run_id, skills, status, exit_code, stop, scale, jobs, done, pending, waiting, not_loaded,
 *                  ineligible, other_arm_unusable, blocked, remaining, excluded, tasks_counted, tasks, results, usd,
 *                  skipped }
 * Every printed line passes through the redactor.
 *
 * `--provider stub` swaps the claude and opencode processes for the stub provider (lib/stub-provider.js): no model,
 * AWS or network call, and the ledger books the cost the stub reports. It is allowed only in a run id `stub` or
 * `stub-<name>`, and such a run id takes only the stub, so made-up answers never mix with real ones.
 *
 * Exit codes (2 is never used: AGENTS.md reserves it for a gate finding):
 *
 *   0   done: every pending run gave a valid answer (every task has a current checklist, every judgment of the
 *       reading is current), or there was nothing to do, or a dry run listed the work
 *   1   refused: `plan` for the same skills refuses them (an invalid baseline, a cost above max_usd, a ledger past a
 *       limit), or for checklists and judge a projection above max_usd, or for checklists a request the writer
 *       cannot be given; nothing was built or spent
 *   3   partial: at least one run failed or was not loaded, a checklist failed or the provider blocked its
 *       writer, or a judgment failed, was blocked by the provider or still waits for an answer or a checklist;
 *       the work that was made is kept
 *   4   stopped, credentials: missing, long-term, or about to expire: for `pairs` within the call timeout (5 minutes
 *       unless set, never less than 3), for the other jobs less than 3 minutes away
 *   5   stopped, spend: the ledger refused a call (max_usd or total_cap_usd)
 *   6   stopped, ledger: the ledger cannot be read or its lock cannot be taken
 *   7   stopped, security: the secret sweep found a credential value or the canary in a stored file
 *   8   stopped, model: the first run was answered by a model other than the subject model
 *   9   stopped, systemic: 4 subject runs, checklists or judgments in a row whose every call failed (a provider or
 *       credential problem)
 *   10  stopped, setup: the first run was invalid for a reason that is neither the skill nor the model (a result that
 *       names no model, tools beyond the grant, a tool outside the grant that ran, the `without` arm loading the skill)
 *   64  usage error, 66 missing input, 70 internal error, 74 I/O error (as in bench.js)
 */
'use strict';

const { describeFailure } = require('./bench');
const { runChecklists } = require('./lib/checklist-job');
const { runJudging } = require('./lib/judge-job');
const {
  BOOL_FLAGS,
  JOBS,
  VALUE_FLAGS,
  parseJobCommand,
} = require('./lib/launch');
const { runPairs } = require('./lib/pairs');
const { redact } = require('./lib/redact');
const { stubJobOptions } = require('./lib/stub-provider');

const EXIT_DONE = 0;
const EXIT_REFUSED = 1;
const EXIT_PARTIAL = 3;
/** The exit code of each stop kind a job can report. */
const STOP_EXIT_CODES = Object.freeze({
  credentials: 4,
  spend: 5,
  ledger: 6,
  security: 7,
  model: 8,
  systemic: 9,
  setup: 10,
});
const USAGE = `Usage: node scripts/bench/job.js <job> --skills <a,b> [options]

Jobs
${Object.entries(JOBS)
  .map(([name, { summary }]) => `  ${name.padEnd(12)}${summary}`)
  .join('\n')}

Options
  --skills <a,b>     Skills to run (required).
  --run <id>         Run folder under bench/out/ (default: default).
  --max-usd <n>      Spend limit for this run in USD, a plain decimal such as 2.5 (default: 30).
  --config <file>    Settings file to use instead of bench/config.json.
  --root <dir>       Repository root to read (default: this checkout).
  --ladder <file>    checklists only: a dose ladder whose items --skills may also name.
  --scale <scale>    judge only, required: items (reading B) or outcome (reading A).
  --provider <name>  live (default) or stub (no model call). A run id stub or stub-<name> takes only stub, and stub only there.
  --dry-run          List the work and stop: nothing is spent or written.

Exit codes
  0   done (or dry run)          1   refused                3   partial
  4   stop: credentials          5   stop: spend            6   stop: ledger
  7   stop: security             8   stop: wrong model      9   stop: systemic
  10  stop: setup
  64  usage error  66  missing input  70  internal error  74  I/O error

Start a job in the background with scripts/bench/launch.js. See scripts/bench/README.md.
`;
/** The last line is one JSON object and must stay whole, so it is not cut at the length of an event line. */
const FINAL_LINE_MAX_CHARS = 1000000;

/** The exit code of a job summary (runPairs, runChecklists or runJudging). */
function exitCodeFor(summary) {
  if (summary.status === 'done' || summary.status === 'dry-run')
    return EXIT_DONE;
  if (summary.status === 'refused') return EXIT_REFUSED;
  if (summary.status === 'partial') return EXIT_PARTIAL;
  if (summary.status === 'stopped') {
    const code = summary.stop && STOP_EXIT_CODES[summary.stop.kind];
    if (code !== undefined) return code;
  }
  throw new Error(
    `job ended with an unknown result: status ${JSON.stringify(summary.status)}, stop ${JSON.stringify(summary.stop && summary.stop.kind)}`,
  );
}

/** Counts of the run results by status (ok, not_loaded, failed, skipped). */
function countResults(results) {
  const counts = {};
  for (const { status } of results) counts[status] = (counts[status] || 0) + 1;
  return counts;
}

/** `base` with `extra` on top; a nested options object (subject, writer, retry) is merged one level down. */
function mergeOptions(base, extra) {
  const merged = { ...base, ...extra };
  for (const [key, value] of Object.entries(extra))
    if (
      value &&
      typeof value === 'object' &&
      base[key] &&
      typeof base[key] === 'object'
    )
      merged[key] = { ...base[key], ...value };
  return merged;
}

/** The pairs job: its summary and its last line. */
async function pairsJob(request, { dryRun, print, pairsOptions }) {
  const summary = await runPairs({
    layout: request.layout,
    config: request.config,
    skills: request.skills,
    dryRun,
    log: print,
    ...pairsOptions,
  });
  return {
    summary,
    last: {
      jobs: summary.jobs,
      pending: summary.pending,
      results: countResults(summary.results),
      skipped: summary.skipped,
    },
  };
}

/** The checklists job: its summary and its last line. Each failed or blocked task is printed by name. */
async function checklistsJob(request, { dryRun, print, checklistOptions }) {
  const summary = await runChecklists({
    layout: request.layout,
    config: request.config,
    skills: request.skills,
    ladder: request.ladder,
    dryRun,
    log: print,
    ...checklistOptions,
  });
  for (const { task, reason } of summary.results.failed)
    print(`failed: ${task}: ${reason}`);
  for (const { task, reason } of summary.results.blocked)
    print(`blocked by the provider: ${task}: ${reason}`);
  return {
    summary,
    last: {
      tasks: summary.tasks,
      done: summary.done,
      pending: summary.pending,
      copies: summary.copies,
      remaining: summary.remaining,
      excluded: summary.excluded.length,
      results: {
        written: summary.results.written.length,
        copied: summary.results.copied.length,
        failed: summary.results.failed.length,
        blocked: summary.results.blocked.length,
      },
      usd: summary.usd,
      skipped: summary.skipped,
    },
  };
}

/**
 * The judge job: its summary and its last line. Each failed judgment is printed by name, and so is each judgment the
 * provider blocked for good and each task that does not count for the reading, with the reason; the counts are always on
 * the last line.
 */
async function judgeJob(request, { dryRun, print, judgeOptions }) {
  const summary = await runJudging({
    layout: request.layout,
    config: request.config,
    skills: request.skills,
    scale: request.scale,
    dryRun,
    log: print,
    ...judgeOptions,
  });
  for (const { judgment, reason } of summary.results.failed)
    print(`failed: ${judgment}: ${reason}`);
  for (const { judgment, reason } of summary.blocked)
    print(`blocked by the provider: ${judgment}: ${reason}`);
  // Before anything is judged every task "does not count", so a dry run prints no task lines.
  if (!dryRun)
    for (const row of summary.tasks)
      if (!row.counted)
        print(
          `task ${row.skill}/${row.batch}/${row.task_id}: not counted: ${row.invalid}`,
        );
  return {
    summary,
    last: {
      scale: summary.scale,
      jobs: summary.jobs,
      done: summary.done,
      pending: summary.pending,
      waiting: summary.waiting.length,
      not_loaded: summary.not_loaded,
      ineligible: summary.ineligible,
      other_arm_unusable: summary.other_arm_unusable,
      blocked: summary.blocked.length,
      remaining: summary.remaining,
      excluded: summary.excluded.length,
      tasks_counted: summary.tasks.filter((task) => task.counted).length,
      tasks: summary.tasks.length,
      results: {
        judged: summary.results.judged.length,
        ineligible: summary.results.ineligible.length,
        failed: summary.results.failed.length,
        refused: summary.results.refused.length,
      },
      usd: summary.usd,
      skipped: summary.skipped,
    },
  };
}

/**
 * Runs the job. `io` is { out(text), err(text) }; `env` is where BENCH_DEBUG is read. `pairsOptions`,
 * `checklistOptions` and `judgeOptions` are extra options for runPairs, runChecklists and runJudging (tests use them
 * for stub calls). Returns the exit code; never throws.
 */
async function main(
  argv,
  io,
  {
    env = process.env,
    pairsOptions = {},
    checklistOptions = {},
    judgeOptions = {},
  } = {},
) {
  const print = (line, maxChars = 8000) =>
    io.out(`${redact(line, { maxChars })}\n`);
  try {
    const command = parseJobCommand(argv);
    if (command.help) {
      io.out(USAGE);
      return EXIT_DONE;
    }
    const { job, options, request } = command;
    const dryRun = options.dryRun === true;
    // The stub provider (lib/stub-provider.js) replaces the claude and opencode processes; test options still win.
    if (request.provider === 'stub') {
      const stub = stubJobOptions();
      pairsOptions = mergeOptions(stub.pairsOptions, pairsOptions);
      checklistOptions = mergeOptions(stub.checklistOptions, checklistOptions);
      judgeOptions = mergeOptions(stub.judgeOptions, judgeOptions);
    }
    print(
      `${job}: run ${request.layout.runId}, skills ${request.skills.join(', ')}${request.scale ? `, scale ${request.scale}` : ''}${request.provider === 'stub' ? ', stub provider' : ''}${dryRun ? ', dry run' : ''}, pid ${process.pid}`,
    );
    const { summary, last } =
      job === 'checklists'
        ? await checklistsJob(request, { dryRun, print, checklistOptions })
        : job === 'judge'
          ? await judgeJob(request, { dryRun, print, judgeOptions })
          : await pairsJob(request, { dryRun, print, pairsOptions });
    for (const reason of summary.refused) print(`refused: ${reason}`);
    for (const warning of summary.warnings) print(`warning: ${warning}`);
    if (summary.stop)
      print(`STOP (${summary.stop.kind}): ${summary.stop.message}`);
    const exitCode = exitCodeFor(summary);
    print(
      JSON.stringify({
        job,
        run_id: request.layout.runId,
        skills: request.skills,
        status: summary.status,
        exit_code: exitCode,
        stop: summary.stop,
        ...last,
      }),
      FINAL_LINE_MAX_CHARS,
    );
    return exitCode;
  } catch (error) {
    const { code, text } = describeFailure(error, {
      debug: env.BENCH_DEBUG === '1',
    });
    io.err(redact(text, { maxChars: 16000 }));
    return code;
  }
}

if (require.main === module) {
  main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  }).then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  main,
  exitCodeFor,
  STOP_EXIT_CODES,
  USAGE,
  VALUE_FLAGS,
  BOOL_FLAGS,
};
