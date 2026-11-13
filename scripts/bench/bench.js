// SPDX-License-Identifier: Apache-2.0
/**
 * Driver for the skill benchmark. It has one command so far:
 *
 *   node scripts/bench/bench.js plan --skills a,b [--run <id>] [--max-usd N] [--config <file>] [--root <dir>] [--json]
 *
 * `plan` is offline. It makes no network, model or AWS call, spends nothing and writes no file. With
 * no --skills it prints this usage and the skills that have a baseline, and does nothing else.
 * `--all` and `--changed-since` are not implemented yet and are refused.
 *
 * README.md in this folder explains the terms and the file formats.
 *
 * Exit codes (the values are the sysexits.h ones where one fits):
 *
 *   0   done
 *   1   the plan is refused: an invalid baseline or agent spec, a projected cost above max_usd, or no selected
 *       skill that can be run (no baseline or no agent)
 *   64  usage error (EX_USAGE): a bad flag or value, an unknown skill, or a settings file that
 *       cannot be read or is invalid
 *   66  a file or folder the plan needs is missing (EX_NOINPUT)
 *   70  internal error (EX_SOFTWARE): a bug in the benchmark. One line says so; the stack trace is
 *       printed only when BENCH_DEBUG=1 is set
 *   74  an I/O error reading a file or folder, such as permission denied (EX_IOERR)
 *
 * Every failure except 70 prints an `error: <what> (<file>)` line and no stack trace (a usage error
 * adds a hint line). Code 2 is never used (AGENTS.md reserves it for a gate finding).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { createLayout } = require('./lib/layout');
const { loadConfig, ConfigError } = require('./lib/config');
const { defaultProfile, CostProfileError } = require('./lib/cost-profile');
const { JsonFileError } = require('./lib/read-file');
const { listSkills } = require('./lib/skills');
const { buildPlan, renderPlan } = require('./lib/plan');

const EX_USAGE = 64;
const EX_NOINPUT = 66;
const EX_SOFTWARE = 70;
const EX_IOERR = 74;
const USAGE = `Usage: node scripts/bench/bench.js plan --skills <a,b> [options]

Commands
  plan    Show the stages a run would take for the selected skills, which are done, and what the
          rest would cost. Offline: no network, no model call, nothing spent.

Options
  --skills <a,b>     Skills to plan. Without it, only this help is shown.
  --run <id>         Run folder under bench/out/ (default: default).
  --max-usd <n>      Spend limit for this run in USD, a plain decimal such as 2.5 (default: 30). Cannot pass total_cap_usd in bench/config.json.
  --config <file>    Settings file to use instead of bench/config.json.
  --root <dir>       Repository root to read (default: this checkout).
  --json             Print the plan as JSON.

Exit codes
  0   done
  1   the plan is refused (an invalid baseline or agent spec, a projected cost above max_usd, or no skill to run)
  64  usage error: a bad flag or value, an unknown skill, or an unreadable or invalid settings file
  66  a file or folder the plan needs is missing
  70  internal error (a bug in the benchmark); set BENCH_DEBUG=1 to print the stack trace
  74  I/O error reading a file or folder, such as permission denied

Every failure except 70 prints an "error: <what> (<file>)" line and no stack trace.
See scripts/bench/README.md for the file formats and what each term means.
`;

class UsageError extends Error {}

/** Why a read failed, by the Node error code. Codes not listed here are shown as they are. */
const IO_REASONS = {
  EACCES: 'permission denied',
  EPERM: 'operation not permitted',
  EISDIR: 'it is a folder, not a file',
  ENOTDIR: 'part of the path is not a folder',
  ELOOP: 'too many symbolic links',
  EIO: 'input/output error',
  EMFILE: 'too many open files',
};
/** `fs` calls that work on a folder, so the message can say "folder" instead of "file". */
const FOLDER_CALLS = new Set(['scandir', 'opendir']);

/**
 * A system error raised by `fs`. Node sets a string `code` and a string `syscall` on these and on no
 * other error this benchmark throws, so an error without both is treated as a bug.
 */
const isSystemError = (error) =>
  error instanceof Error &&
  typeof error.code === 'string' &&
  typeof error.syscall === 'string';

/**
 * Turns anything thrown while running into { code, text }: the exit code and what to print on stderr.
 * Only a bug (70) can carry a stack trace, and only when `debug` is true.
 */
function describeFailure(error, { debug = false } = {}) {
  if (error instanceof UsageError)
    return {
      code: EX_USAGE,
      text: `error: ${error.message}\nRun with --help for usage.\n`,
    };
  if (isSystemError(error)) {
    const kind = FOLDER_CALLS.has(error.syscall) ? 'folder' : 'file';
    const where = error.path ? ` (${error.path})` : '';
    if (error.code === 'ENOENT')
      return {
        code: EX_NOINPUT,
        text: `error: required ${kind} is missing${where}\n`,
      };
    return {
      code: EX_IOERR,
      text: `error: cannot read ${kind}: ${IO_REASONS[error.code] || error.code}${where}\n`,
    };
  }
  const message =
    error instanceof Error
      ? error.message.split('\n')[0].replace(/\.$/, '')
      : String(error);
  const stack = debug
    ? `${error instanceof Error && error.stack ? error.stack : String(error)}\n`
    : '';
  const hint = debug ? '' : ' Set BENCH_DEBUG=1 to print the stack trace.';
  return {
    code: EX_SOFTWARE,
    text: `error: internal error, this is a bug in the benchmark: ${message}.${hint}\n${stack}`,
  };
}

const VALUE_FLAGS = {
  '--skills': 'skills',
  '--run': 'run',
  '--max-usd': 'maxUsd',
  '--config': 'config',
  '--root': 'root',
};
const BOOL_FLAGS = { '--json': 'json', '--help': 'help', '-h': 'help' };
const UNSUPPORTED_SELECTIONS = ['--all', '--changed-since'];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const equalsIndex = rest[i].startsWith('-') ? rest[i].indexOf('=') : -1;
    const flag = equalsIndex > 0 ? rest[i].slice(0, equalsIndex) : rest[i];
    if (UNSUPPORTED_SELECTIONS.includes(flag))
      throw new UsageError(
        `${flag} is not available yet; select skills with --skills a,b`,
      );
    if (Object.hasOwn(BOOL_FLAGS, flag)) {
      // `--json=false` must not switch JSON on, so a value on a flag that takes none is refused.
      if (equalsIndex > 0)
        throw new UsageError(`${flag} does not take a value`);
      options[BOOL_FLAGS[flag]] = true;
    } else if (Object.hasOwn(VALUE_FLAGS, flag)) {
      const value =
        equalsIndex > 0 ? rest[i].slice(equalsIndex + 1) : rest[++i];
      if (value === undefined || value === '' || value.startsWith('--'))
        throw new UsageError(`${flag} needs a value`);
      options[VALUE_FLAGS[flag]] = value;
    } else {
      throw new UsageError(`unknown option ${flag}`);
    }
  }
  return { command, options };
}

/** Digits with an optional fraction: "2.5" and "25". Not "0x10", "1e1", " 5 ", "+5", ".5" or "5.". */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/** The value of --max-usd as a number. `Number()` alone would read hex, exponents and padded text. */
function parseMaxUsd(text) {
  const maxUsd = PLAIN_DECIMAL.test(text) ? Number(text) : NaN;
  if (!(Number.isFinite(maxUsd) && maxUsd > 0))
    throw new UsageError(
      `--max-usd: must be a plain decimal number above 0 such as 2.5, got ${JSON.stringify(text)}`,
    );
  return maxUsd;
}

function parseSkillSelection(skillList) {
  const names = [
    ...new Set(
      skillList
        .split(',')
        .map((skillName) => skillName.trim())
        .filter(Boolean),
    ),
  ];
  if (!names.length)
    throw new UsageError('--skills needs at least one skill name');
  return names;
}

function listBaselineSkills(layout) {
  if (!fs.existsSync(layout.baselinesDir)) return [];
  return fs
    .readdirSync(layout.baselinesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Runs the driver. `io` is { out(text), err(text) }; `env` is where BENCH_DEBUG is read. Returns the
 * exit code and never calls process.exit or throws.
 */
function main(argv, io, env = process.env) {
  try {
    const { command, options } = parseArgs(argv);
    if (!command || command === '--help' || command === '-h' || options.help) {
      io.out(USAGE);
      return 0;
    }
    if (command !== 'plan')
      throw new UsageError(
        `unknown command "${command}"; the only command so far is plan`,
      );

    const maxUsd =
      options.maxUsd === undefined ? undefined : parseMaxUsd(options.maxUsd);
    let layout;
    let config;
    try {
      layout = createLayout({
        root: options.root && path.resolve(options.root),
        runId: options.run,
      });
    } catch (error) {
      throw new UsageError(error.message);
    }
    // A wrong --root is named before its missing settings file, which would only be a symptom of it.
    if (!fs.existsSync(layout.skillsDir))
      throw new UsageError('the repository root has no skills/ folder');
    try {
      config = loadConfig({
        defaultFile: layout.configFile,
        file: options.config && path.resolve(options.config),
        overrides: maxUsd === undefined ? undefined : { max_usd: maxUsd },
      });
    } catch (error) {
      // A settings problem is the user's to fix (exit 64); anything else is a bug and goes on to exit 70.
      if (!(error instanceof ConfigError)) throw error;
      throw new UsageError(error.message);
    }
    // The committed cost profile prices every call; a broken one is named here, not found mid-plan as a bug.
    try {
      defaultProfile();
    } catch (error) {
      if (!(
        error instanceof CostProfileError || error instanceof JsonFileError
      ))
        throw error;
      throw new UsageError(error.message);
    }

    if (!options.skills) {
      const baselineSkillNames = listBaselineSkills(layout);
      io.out(
        `${USAGE}\nNo skills selected, so nothing was planned and nothing was spent.\nSkills with a baseline: ${baselineSkillNames.length ? baselineSkillNames.join(', ') : 'none'}\n`,
      );
      return 0;
    }
    const names = parseSkillSelection(options.skills);
    const knownSkills = listSkills(layout.skillsDir);
    const unknownSkills = names.filter((name) => !knownSkills.includes(name));
    if (unknownSkills.length)
      throw new UsageError(
        `unknown skill(s) in --skills: ${unknownSkills.join(', ')} (no skills/<name>/SKILL.md)`,
      );

    const plan = buildPlan({ layout, config, skills: names });
    io.out(
      options.json ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan),
    );
    return plan.ok ? 0 : 1;
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

module.exports = {
  main,
  parseArgs,
  describeFailure,
  USAGE,
  EX_USAGE,
  EX_NOINPUT,
  EX_SOFTWARE,
  EX_IOERR,
};
