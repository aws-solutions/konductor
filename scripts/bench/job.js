// SPDX-License-Identifier: Apache-2.0
/**
 * Runs one benchmark job in the foreground. The launcher (launch.js) starts this script detached, with its output
 * going to the job's log; it can also be run by hand.
 *
 *   node scripts/bench/job.js pairs --skills a,b [--run <id>] [--max-usd N] [--config <file>] [--root <dir>] [--dry-run]
 *
 * `pairs` makes the subject runs (lib/pairs.js) and SPENDS MONEY unless --dry-run is given. The options are checked
 * the same way the launcher checks them (lib/launch.js parseJobCommand). The job prints one line per event, then a
 * last line that is one JSON object: { job, run_id, skills, status, exit_code, stop, jobs, pending, results, skipped }.
 * Every printed line passes through the redactor.
 *
 * Exit codes (2 is never used: AGENTS.md reserves it for a gate finding):
 *
 *   0   done: every pending run gave a valid answer, or there was nothing to run, or a dry run listed the runs
 *   1   refused: `plan` for the same skills refuses them (an invalid baseline, a cost above max_usd, a ledger past a
 *       limit); nothing was built or spent
 *   3   partial: at least one run failed or was not loaded; the answers that were made are kept
 *   4   stopped, credentials: missing, long-term, or expiring within the call timeout (5 minutes unless set, never
 *       less than 3)
 *   5   stopped, spend: the ledger refused a call (max_usd or total_cap_usd)
 *   6   stopped, ledger: the ledger cannot be read or its lock cannot be taken
 *   7   stopped, security: the secret sweep found a credential value or the canary in a stored file
 *   8   stopped, model: the first run was answered by a model other than the subject model
 *   10  stopped, setup: the first run was invalid for a reason that is neither the skill nor the model (a result that
 *       names no model, tools beyond the grant, a tool outside the grant that ran, the `without` arm loading the skill)
 *   64  usage error, 66 missing input, 70 internal error, 74 I/O error (as in bench.js)
 */
'use strict';

const { describeFailure } = require('./bench');
const {
  BOOL_FLAGS,
  JOBS,
  VALUE_FLAGS,
  parseJobCommand,
} = require('./lib/launch');
const { runPairs } = require('./lib/pairs');
const { redact } = require('./lib/redact');

const EXIT_DONE = 0;
const EXIT_REFUSED = 1;
const EXIT_PARTIAL = 3;
/** The exit code of each stop kind runPairs can report. */
const STOP_EXIT_CODES = Object.freeze({
  credentials: 4,
  spend: 5,
  ledger: 6,
  security: 7,
  model: 8,
  setup: 10,
});
const USAGE = `Usage: node scripts/bench/job.js <job> --skills <a,b> [options]

Jobs
${Object.entries(JOBS)
  .map(([name, { summary }]) => `  ${name.padEnd(8)}${summary}`)
  .join('\n')}

Options
  --skills <a,b>     Skills to run (required).
  --run <id>         Run folder under bench/out/ (default: default).
  --max-usd <n>      Spend limit for this run in USD, a plain decimal such as 2.5 (default: 30).
  --config <file>    Settings file to use instead of bench/config.json.
  --root <dir>       Repository root to read (default: this checkout).
  --dry-run          List the work and stop: nothing is spent or written.

Exit codes
  0   done (or dry run)          1   refused by plan        3   partial
  4   stop: credentials          5   stop: spend            6   stop: ledger
  7   stop: security             8   stop: wrong model
  10  stop: setup
  64  usage error  66  missing input  70  internal error  74  I/O error

Start a job in the background with scripts/bench/launch.js. See scripts/bench/README.md.
`;
/** The last line is one JSON object and must stay whole, so it is not cut at the length of an event line. */
const FINAL_LINE_MAX_CHARS = 1000000;

/** The exit code of a runPairs summary. */
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
    `pairs job ended with an unknown result: status ${JSON.stringify(summary.status)}, stop ${JSON.stringify(summary.stop && summary.stop.kind)}`,
  );
}

/** Counts of the run results by status (ok, not_loaded, failed, skipped). */
function countResults(results) {
  const counts = {};
  for (const { status } of results) counts[status] = (counts[status] || 0) + 1;
  return counts;
}

/**
 * Runs the job. `io` is { out(text), err(text) }; `env` is where BENCH_DEBUG is read. `pairsOptions` are extra
 * options for runPairs (tests use them for the stub process runner). Returns the exit code; never throws.
 */
async function main(argv, io, { env = process.env, pairsOptions = {} } = {}) {
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
    print(
      `${job}: run ${request.layout.runId}, skills ${request.skills.join(', ')}${dryRun ? ', dry run' : ''}, pid ${process.pid}`,
    );
    const summary = await runPairs({
      layout: request.layout,
      config: request.config,
      skills: request.skills,
      dryRun,
      log: print,
      ...pairsOptions,
    });
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
        jobs: summary.jobs,
        pending: summary.pending,
        results: countResults(summary.results),
        skipped: summary.skipped,
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
