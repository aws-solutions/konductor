// SPDX-License-Identifier: Apache-2.0
/**
 * Starts one benchmark job in the background and prints ONE JSON line, then exits. The job keeps running.
 *
 *   node scripts/bench/launch.js pairs --skills a,b [--run <id>] [--max-usd N] [--config <file>] [--root <dir>] [--dry-run]
 *   node scripts/bench/launch.js checklists --skills a,b [--ladder <file>] [same options]
 *   node scripts/bench/launch.js judge --scale items|outcome --skills a,b [same options]
 *
 * The job is `node scripts/bench/job.js` with the same, checked options (lib/launch.js). Its log and pid file are in
 * bench/out/<run-id>/jobs/ (lib/job-dir.js). A job that is already running for the same skills is not started again.
 *
 * Printed on success:  {"job","run_id","skills","dry_run","pid","already_running","log_file","pid_file"}, and
 *                      "scale" after "job" for a judge job
 * Printed on failure:  {"error": "<what went wrong>", "exit_code": <code>}
 *
 * Exit 0 means the job was started, not that it will be accepted: the job checks `plan` for the same skills as its
 * first step and can still refuse (exit 1 in its own log). The result of the job is the last line of its log.
 *
 * Exit codes:
 *   0   the job was started, or it was already running
 *   1   refused: another live job of the same kind (for judge, of the same scale) runs one of these skills, a pid
 *       file names a process that cannot be checked, or another launch holds the lock
 *   64  usage error: a bad flag or value, an unknown job or skill, an invalid settings file
 *   66  a file or folder is missing, 70 internal error, 74 I/O error (as in bench.js)
 */
'use strict';

const { describeFailure, isSystemError } = require('./bench');
const {
  BOOL_FLAGS,
  JOBS,
  LaunchRefusedError,
  VALUE_FLAGS,
  launchJob,
  parseJobCommand,
} = require('./lib/launch');
const { redact } = require('./lib/redact');

const EXIT_REFUSED = 1;
const USAGE = `Usage: node scripts/bench/launch.js <job> --skills <a,b> [options]

Starts the job in the background, prints one JSON line with its pid and log file, and exits.

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
  --dry-run          Start the job in its dry-run mode: it lists the work and spends nothing.

Exit codes
  0   started, or already running      1   refused: another job runs one of these skills
  64  usage error  66  missing input  70  internal error  74  I/O error
`;

/**
 * The text of a failure as one line for the JSON line: the leading `error: ` and the `Run with --help` hint are
 * dropped, and the lines of a multi-line failure (the reasons under `invalid benchmark settings`) are joined with `; `.
 */
function oneLine(text) {
  return text
    .replace(/^error: /, '')
    .split('\n')
    .map((line) => line.trim().replace(/^- /, ''))
    .filter((line) => line && !line.startsWith('Run with --help'))
    .reduce(
      (joined, line) =>
        joined === ''
          ? line
          : `${joined}${joined.endsWith(':') ? ' ' : '; '}${line}`,
      '',
    );
}

/**
 * Runs the launcher. `io` is { out(text), err(text) }. `launchOptions` are passed to launchJob (tests use them for a
 * stub start). Returns the exit code; never throws.
 */
function main(argv, io, { env = process.env, launchOptions = {} } = {}) {
  try {
    const command = parseJobCommand(argv);
    if (command.help) {
      io.out(USAGE);
      return 0;
    }
    const { options, request } = command;
    let started;
    try {
      started = launchJob(request, {
        dryRun: options.dryRun === true,
        ...launchOptions,
      });
    } catch (error) {
      // Every step of a launch that can fail with a system error creates or writes something.
      if (isSystemError(error)) error.writing = true;
      throw error;
    }
    io.out(`${JSON.stringify(started)}\n`);
    return 0;
  } catch (error) {
    const debug = env.BENCH_DEBUG === '1';
    const refused = error instanceof LaunchRefusedError;
    const { code, text } = refused
      ? { code: EXIT_REFUSED, text: error.message }
      : describeFailure(error, { debug: false });
    io.out(
      `${JSON.stringify({ error: redact(oneLine(text), { maxChars: 2000 }), exit_code: code })}\n`,
    );
    // The stack trace of a bug (BENCH_DEBUG=1) goes to stderr, never into the JSON line.
    if (debug && !refused)
      io.err(
        redact(describeFailure(error, { debug }).text, { maxChars: 16000 }),
      );
    return code;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}

module.exports = { main, USAGE, VALUE_FLAGS, BOOL_FLAGS };
