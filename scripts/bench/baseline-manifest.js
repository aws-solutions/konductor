// SPDX-License-Identifier: Apache-2.0
/**
 * The baseline manifest and its check:
 *
 *   node scripts/bench/baseline-manifest.js check [--root <dir>]   verify bench/baselines/ against MANIFEST.json
 *   node scripts/bench/baseline-manifest.js write [--root <dir>]   rewrite MANIFEST.json from the files, then check
 *
 * Offline: no network, model or AWS call, nothing spent. `write` changes only bench/baselines/MANIFEST.json.
 *
 * Exit codes are the driver's (bench.js): 0 clean, 1 a problem was found (each is printed as an `error:` line on
 * stderr), 64 usage error, 66 a file or folder is missing, 70 internal error, 74 I/O error. Warnings (a stale
 * rules or tasks file) are printed on stdout and do not change the exit code.
 */
'use strict';

const path = require('path');
const { createLayout } = require('./lib/layout');
const { UsageError, parseFlags } = require('./lib/cli-args');
const { describeFailure } = require('./bench');
const { verifyBaselines, writeManifest } = require('./lib/baseline-manifest');

const COMMANDS = ['check', 'write'];
const USAGE = `Usage: node scripts/bench/baseline-manifest.js <check|write> [--root <dir>]

  check   Verify bench/baselines/ against bench/baselines/MANIFEST.json: every file listed, every hash equal,
          no credential-shaped text, home-directory path or non-example 12-digit number, every skill valid.
  write   Rewrite MANIFEST.json from the files on disk, then run check.
`;

/** Runs the command. `io` is { out(text), err(text) }. Returns the exit code; never throws. */
function main(argv, io, env = process.env) {
  try {
    const [command, ...rest] = argv;
    if (!command || command === '--help' || command === '-h') {
      io.out(USAGE);
      return 0;
    }
    if (!COMMANDS.includes(command))
      throw new UsageError(
        `unknown command "${command}"; the commands are ${COMMANDS.join(', ')}`,
      );
    const options = parseFlags(rest, { valueFlags: { '--root': 'root' } });
    let layout;
    try {
      layout = createLayout({
        root: options.root && path.resolve(options.root),
      });
    } catch (error) {
      throw new UsageError(error.message);
    }
    if (command === 'write') writeManifest(layout);
    const { problems, warnings, fileCount, skillCount } =
      verifyBaselines(layout);
    for (const warning of warnings) io.out(`warning: ${warning}\n`);
    for (const problem of problems) io.err(`error: ${problem}\n`);
    if (problems.length) return 1;
    io.out(
      `ok: ${fileCount} files of ${skillCount} skills match MANIFEST.json and pass the checks\n`,
    );
    return 0;
  } catch (error) {
    const { code, text } = describeFailure(error, {
      debug: env.BENCH_DEBUG === '1',
    });
    io.err(text);
    return code;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}

module.exports = { main, USAGE };
