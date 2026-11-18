// SPDX-License-Identifier: Apache-2.0
/**
 * Driver for the skill benchmark. Three commands:
 *
 *   node scripts/bench/bench.js plan --skills a,b [--run <id>] [--max-usd N] [--config <file>] [--root <dir>] [--json]
 *   node scripts/bench/bench.js next --skills a,b [--run <id>] [--max-usd N] [--config <file>] [--root <dir>]
 *                                   [--max-minutes N --started-at <UTC time>] [--provider live|stub]
 *   node scripts/bench/bench.js report --skills a,b [--run <id>] [--config <file>] [--root <dir>] [--provider live|stub]
 *   node scripts/bench/bench.js cost-profile [--ledger <file>] [--out <file>] [--root <dir>]
 *   node scripts/bench/bench.js trim --run <id> [--skills a,b] [--threshold 4.8] [--min-per-batch 5] [--dry-run] [--list-kept]
 *                                    [--config <file>] [--root <dir>]
 *
 * `plan` is offline. It makes no network, model or AWS call, spends nothing and writes no file. With
 * no --skills it prints this usage and the skills that have a baseline, and does nothing else.
 * `--all` and `--changed-since` are not implemented yet and are refused.
 *
 * `next` (lib/next.js) prints ONE JSON line: the next job to run with its command, `done`, or `stop` with the reason.
 * It works from the baseline and the files on disk, spends nothing and writes no file.
 *
 * `report` (lib/run-report.js) reads the stored answers and judgments, applies the label rules and writes
 * bench/out/<run-id>/report.json and report.md, then prints ONE JSON line naming them. Offline: no network, model or
 * AWS call, nothing spent, and no other file written. `--provider stub` reads the spend of a stub run from its own
 * ledger.
 *
 * `cost-profile` (lib/cost-profile-rebuild.js) reads the spend ledger and prints a cost profile built from the calls
 * whose cost the CLI reported, or writes it to --out. It needs no settings file and spends nothing.
 *
 * `trim` (lib/trim.js) drops the tasks a trusted run found easy from the committed baselines and refreshes
 * bench/baselines/MANIFEST.json, then prints ONE JSON line: per skill and batch, how many tasks are kept (their ids
 * with `--list-kept`), which are dropped and which are restored, and the rules a batch has no item for any more. It
 * reads the stored judgments like `report`, spends nothing and changes only files under bench/baselines/; `--dry-run`
 * changes nothing. It is refused (64) for a run that is not trusted, a missing or stale report, a skill that reading A
 * covers too thinly, a rule that would have no item left in any batch of its skill, or a baseline file edited after
 * the plan was made.
 *
 * README.md in this folder explains the terms and the file formats.
 *
 * Exit codes (the values are the sysexits.h ones where one fits):
 *
 *   0   done (for next: a job to run, or done; for report: the report is written; for trim: the baselines are
 *       trimmed, or would be with --dry-run)
 *   1   the plan is refused: an invalid baseline or agent spec, a projected cost above max_usd, a plan that
 *       would take the spend ledger past total_cap_usd, or no selected skill that can be run
 *       (no baseline or no agent); for next: stop (a limit is reached, or the plan is refused); for trim: the
 *       baselines do not match MANIFEST.json before or after the trim
 *   64  usage error (EX_USAGE): a bad flag or value, an unknown skill, a settings file that
 *       cannot be read or is invalid, a spend ledger that cost-profile cannot parse, a text in the data
 *       of `report` that is too long for the redactor to scan, or a trim that is refused (the run is not trusted,
 *       its report is missing or stale, or a skill's reading A covers fewer than 12 of every 16 tasks)
 *   66  a file or folder the plan needs is missing (EX_NOINPUT)
 *   70  internal error (EX_SOFTWARE): a bug in the benchmark. One line says so; the stack trace is
 *       printed only when BENCH_DEBUG=1 is set
 *   74  an I/O error reading or writing a file or folder, such as permission denied (EX_IOERR)
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
const { rebuildProfile } = require('./lib/cost-profile-rebuild');
const { LedgerError } = require('./lib/ledger');
const { JsonFileError } = require('./lib/read-file');
const { listControlSkills, listSkills } = require('./lib/skills');
const { buildPlan, renderPlan } = require('./lib/plan');
const { DOSE_LADDER, selectedLadder } = require('./lib/controls');
const { redact } = require('./lib/redact');
const {
  UsageError,
  parseFlags,
  parseMaxMinutes,
  parseMaxUsd,
  parseSkillSelection,
  parseStartedAt,
} = require('./lib/cli-args');

const EX_USAGE = 64;
const EX_NOINPUT = 66;
const EX_SOFTWARE = 70;
const EX_IOERR = 74;
const USAGE = `Usage: node scripts/bench/bench.js <plan|next|report> --skills <a,b> [options]
       node scripts/bench/bench.js cost-profile [--ledger <file>] [--out <file>] [--root <dir>]
       node scripts/bench/bench.js trim --run <id> [--skills <a,b>] [--threshold <n>] [--min-per-batch <n>] [--dry-run] [--list-kept]

Commands
  plan    Show the stages a run would take for the selected skills, which are done, and what the
          rest would cost. Offline: no network, no model call, nothing spent.
  next    Print one JSON line: the next job to run and its command, done, or stop with the reason.
          Works from the files on disk; nothing spent, nothing written.
  report  Read the stored answers and judgments, apply the label rules and write report.json and
          report.md in the run folder. Offline: no network, no model call, nothing spent.
  cost-profile  Rebuild the cost profile (mean, median, p90 per call kind and model) from the
          spend ledger. Offline: nothing spent.
  trim    Drop the easy tasks of a trusted run from the committed baselines and refresh the manifest: a
          task whose reading A mean is at or above the threshold both without and with the skill. Offline: nothing spent.

Options
  --skills <a,b>     Skills to plan. Without it, only this help is shown. The controls are named the
                     same way: convention-control, and dose-ladder (next and report only).
  --run <id>         Run folder under bench/out/ (default: default).
  --max-usd <n>      plan and next: spend limit for this run in USD, a plain decimal such as 2.5 (default: 30). Cannot pass total_cap_usd in bench/config.json.
  --config <file>    Settings file to use instead of bench/config.json.
  --root <dir>       Repository root to read (default: this checkout).
  --json             plan only: print the plan as JSON.
  --max-minutes <n>  next only: time limit of the run; needs --started-at.
  --started-at <t>   next only: when the run started, a UTC time such as 2026-11-12T15:30:00Z.
  --provider <name>  next and report: live (default) or stub. next passes it on to the job's command;
                     report reads a stub run's spend from its own ledger. A run id stub or stub-<name> takes only
                     stub, and stub only there.
  --ledger <file>    cost-profile only: the spend ledger to read (default: bench/out/ledger.jsonl).
  --out <file>       cost-profile only: write the profile there instead of printing it.
  --threshold <n>    trim only: drop a task whose reading A mean is at least n both without and with the skill, 1 to 5
                     (default: 4.8). A task with no counted with-skill judgment stays.
  --min-per-batch <n>  trim only: keep at least n tasks in each batch, 5 or more (default: 5). The dropped tasks
                     with the lowest means (the lower of the two arms) stay when a batch would fall below it.
  --dry-run          trim only: print what would be dropped and write nothing.
  --list-kept        trim only: also print the ids of the tasks that stay (a long line for many skills).

Exit codes
  0   done (next: a job to run, or done; report: the report is written; trim: the baselines are trimmed)
  1   the plan is refused (an invalid baseline or agent spec, a projected cost above max_usd, a ledger past a limit, or no skill to run); next: stop; trim: the baselines do not match MANIFEST.json
  64  usage error: a bad flag or value, an unknown skill, an unreadable or invalid settings file, (cost-profile) a corrupt ledger, or (trim) a run that is not trusted, a missing or stale report, or too thin a reading A
  66  a file or folder the plan needs is missing
  70  internal error (a bug in the benchmark); set BENCH_DEBUG=1 to print the stack trace
  74  I/O error reading a file or folder, such as permission denied

Every failure except 70 prints an "error: <what> (<file>)" line and no stack trace.
See scripts/bench/README.md for the file formats and what each term means.
`;

/** Why a read failed, by the Node error code. Codes not listed here are shown as they are. */
const IO_REASONS = {
  ENOENT: 'no such file or folder',
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
 * Only a bug (70) can carry a stack trace, and only when `debug` is true. An error with a string `hint` gets it as a
 * second `error:` line, so advice the code attached (what to repair after a failed write) is not lost.
 */
function describeFailure(error, options = {}) {
  const described = describeFailureLine(error, options);
  if (error && typeof error.hint === 'string' && error.hint)
    described.text = `${described.text.replace(/\n$/, '')}\nerror: ${error.hint}\n`;
  return described;
}

function describeFailureLine(error, { debug = false } = {}) {
  if (error instanceof UsageError)
    return {
      code: EX_USAGE,
      text: `error: ${error.message}\nRun with --help for usage.\n`,
    };
  if (isSystemError(error)) {
    const kind = FOLDER_CALLS.has(error.syscall) ? 'folder' : 'file';
    const where = error.path ? ` (${error.path})` : '';
    if (error.writing)
      return {
        code: EX_IOERR,
        text: `error: cannot write ${kind}: ${IO_REASONS[error.code] || error.code}${where}\n`,
      };
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
  '--max-minutes': 'maxMinutes',
  '--started-at': 'startedAt',
  '--provider': 'provider',
  '--ledger': 'ledger',
  '--out': 'out',
  '--threshold': 'threshold',
  '--min-per-batch': 'minPerBatch',
};
/** Flags only `next` takes; `plan` refuses them, so a typo cannot pass quietly. */
const NEXT_ONLY_FLAGS = ['maxMinutes', 'startedAt', 'provider'];
/** Flags `report` refuses: it plans and spends nothing, so a limit would do nothing there. */
const NOT_REPORT_FLAGS = ['maxUsd', 'maxMinutes', 'startedAt'];
/** Flags only `cost-profile` takes, and the only flags it takes besides --root. */
const COST_PROFILE_FLAGS = ['ledger', 'out'];
/** Flags only `trim` takes. */
const TRIM_ONLY_FLAGS = ['threshold', 'minPerBatch', 'dryRun', 'listKept'];
/** Flags `trim` refuses besides --json: it spends nothing, runs no job and takes the provider from the stored report. */
const NOT_TRIM_FLAGS = ['maxUsd', 'maxMinutes', 'startedAt', 'provider'];
const COMMANDS = ['plan', 'next', 'report', 'cost-profile', 'trim'];
const BOOL_FLAGS = {
  '--json': 'json',
  '--dry-run': 'dryRun',
  '--list-kept': 'listKept',
  '--help': 'help',
  '-h': 'help',
};
/** The command-line spelling of a parsed option name (`maxUsd` is `--max-usd`). */
const flagOf = (name) =>
  Object.entries({ ...VALUE_FLAGS, ...BOOL_FLAGS }).find(
    ([, option]) => option === name,
  )?.[0] || name;
const UNSUPPORTED_SELECTIONS = ['--all', '--changed-since'];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = parseFlags(rest, {
    valueFlags: VALUE_FLAGS,
    boolFlags: BOOL_FLAGS,
    refusedFlags: Object.fromEntries(
      UNSUPPORTED_SELECTIONS.map((flag) => [
        flag,
        `${flag} is not available yet; select skills with --skills a,b`,
      ]),
    ),
  });
  return { command, options };
}

function listBaselineSkills(layout) {
  if (!fs.existsSync(layout.baselinesDir)) return [];
  return fs
    .readdirSync(layout.baselinesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** True when two absolute paths name one file, following links when the files exist. */
function samePath(first, second) {
  const real = (file) => {
    try {
      return fs.realpathSync(file);
    } catch {
      return file;
    }
  };
  return first === second || real(first) === real(second);
}

/**
 * Runs the driver. `io` is { out(text), err(text) }; `env` is where BENCH_DEBUG is read. Returns the
 * exit code and never calls process.exit or throws. `plan` returns the code itself; `next` returns a
 * promise of it, because its dry runs read the arms asynchronously. `nextOptions` are extra options
 * for nextStep (tests: now, jobOptions).
 */
function main(argv, io, env = process.env, nextOptions = {}) {
  const fail = (error) => {
    const { code, text } = describeFailure(error, {
      debug: env.BENCH_DEBUG === '1',
    });
    io.err(text);
    return code;
  };
  try {
    const { command, options } = parseArgs(argv);
    if (!command || command === '--help' || command === '-h' || options.help) {
      io.out(USAGE);
      return 0;
    }
    if (!COMMANDS.includes(command))
      throw new UsageError(
        `unknown command "${command}"; the commands are ${COMMANDS.join(', ')}`,
      );
    if (command === 'cost-profile') return runCostProfile({ options, io });
    const costProfileOnly = COST_PROFILE_FLAGS.filter(
      (name) => name in options,
    );
    if (costProfileOnly.length)
      throw new UsageError(
        `${costProfileOnly.map(flagOf).join(', ')} is an option of cost-profile, not of ${command}`,
      );
    const trimOnly = TRIM_ONLY_FLAGS.filter((name) => name in options);
    if (trimOnly.length && command !== 'trim')
      throw new UsageError(
        `${trimOnly.map(flagOf).join(', ')} is an option of trim, not of ${command}`,
      );
    if (command === 'trim') {
      const refusedByTrim = NOT_TRIM_FLAGS.filter((name) => name in options);
      if (refusedByTrim.length)
        throw new UsageError(
          `${refusedByTrim.map(flagOf).join(', ')} is not an option of trim: it spends nothing and runs no job`,
        );
    }
    if (command === 'plan') {
      const nextOnly = NEXT_ONLY_FLAGS.filter((name) => name in options);
      if (nextOnly.length)
        throw new UsageError(
          `${nextOnly.map(flagOf).join(', ')} is an option of next, not of plan`,
        );
    }
    if (command === 'report') {
      const refused = NOT_REPORT_FLAGS.filter((name) => name in options);
      if (refused.length)
        throw new UsageError(
          `${refused.map(flagOf).join(', ')} is not an option of report: it spends nothing`,
        );
    }
    if (command !== 'plan' && options.json)
      throw new UsageError(
        `${command} always prints JSON; --json is an option of plan`,
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

    if (command === 'trim')
      return runTrimCommand({ layout, config, options, nextOptions, io });

    if (!options.skills) {
      if (command !== 'plan')
        throw new UsageError(
          `--skills is required: name the skills to ${command === 'next' ? 'run' : 'report'}`,
        );
      const baselineSkillNames = listBaselineSkills(layout);
      io.out(
        `${USAGE}\nNo skills selected, so nothing was planned and nothing was spent.\nSkills with a baseline: ${baselineSkillNames.length ? baselineSkillNames.join(', ') : 'none'}\n`,
      );
      return 0;
    }
    const names = parseSkillSelection(options.skills);
    const knownSkills = [
      ...listSkills(layout.skillsDir),
      ...listControlSkills(layout),
      ...(fs.existsSync(layout.ladderFile) ? [DOSE_LADDER] : []),
    ];
    const unknownSkills = names.filter((name) => !knownSkills.includes(name));
    if (unknownSkills.length)
      throw new UsageError(
        `unknown skill(s) in --skills: ${unknownSkills.join(', ')} (no skills/<name>/SKILL.md, and not a control)`,
      );
    if (names.includes(DOSE_LADDER)) {
      if (command === 'plan')
        throw new UsageError(
          `${DOSE_LADDER} is a control of next and report; plan prices the skills and control skills only`,
        );
      try {
        selectedLadder(layout);
      } catch (error) {
        throw new UsageError(`--skills ${DOSE_LADDER}: ${error.message}`);
      }
    }

    if (command === 'next')
      return runNext({ layout, config, names, options, nextOptions, io }).catch(
        fail,
      );
    if (command === 'report')
      return runReport({ layout, config, names, options, nextOptions, io });

    const plan = buildPlan({ layout, config, skills: names });
    io.out(
      options.json ? `${JSON.stringify(plan, null, 2)}\n` : renderPlan(plan),
    );
    return plan.ok ? 0 : 1;
  } catch (error) {
    return fail(error);
  }
}

/**
 * The `cost-profile` command: rebuilds the cost profile from a spend ledger (cost-profile-rebuild.js). `--ledger`
 * names the ledger (default: bench/out/ledger.jsonl under --root); `--out` names the file to write, and without it
 * the profile is printed as JSON. `--out` may not name the ledger or its lock file. A ledger that cannot be parsed
 * is a usage error (64). The current profile is the committed one. Offline; spends nothing. Exit 0.
 */
function runCostProfile({ options, io }) {
  const other = Object.keys(options).filter(
    (name) => !['ledger', 'out', 'root', 'help'].includes(name),
  );
  if (other.length)
    throw new UsageError(
      `cost-profile takes only --ledger, --out and --root, got ${other.map(flagOf).join(', ')}`,
    );
  let layout;
  try {
    layout = createLayout({ root: options.root && path.resolve(options.root) });
  } catch (error) {
    throw new UsageError(error.message);
  }
  let current;
  try {
    current = defaultProfile();
  } catch (error) {
    if (!(error instanceof CostProfileError || error instanceof JsonFileError))
      throw error;
    throw new UsageError(error.message);
  }
  const ledgerFile = options.ledger
    ? path.resolve(options.ledger)
    : layout.ledgerFile;
  const outFile = options.out && path.resolve(options.out);
  // Writing the profile over the ledger (or its lock) would destroy every spend row.
  if (
    outFile &&
    [ledgerFile, `${ledgerFile}.lock`].some((file) => samePath(file, outFile))
  )
    throw new UsageError(
      `--out cannot be the spend ledger or its lock file (${outFile})`,
    );
  let rebuilt;
  try {
    rebuilt = rebuildProfile({
      ledgerFile,
      current,
      today: new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    // A corrupt ledger is a problem with the input, not a bug in the benchmark.
    if (!(error instanceof LedgerError)) throw error;
    throw new UsageError(error.message);
  }
  const { profile } = rebuilt;
  const text = `${JSON.stringify(profile, null, 2)}\n`;
  if (!outFile) {
    io.out(text);
    return 0;
  }
  // Written next to the target and renamed into place, so a crash cannot leave a half-written profile.
  const tmpFile = `${outFile}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpFile, text);
    fs.renameSync(tmpFile, outFile);
  } catch (error) {
    fs.rmSync(tmpFile, { force: true });
    // A missing folder is a write failure here (exit 74), not a missing input (66).
    if (isSystemError(error)) error.writing = true;
    throw error;
  }
  io.out(
    `wrote ${outFile}: ${profile.entries.length} entries from ${ledgerFile}\n`,
  );
  return 0;
}

/** The `next` command: one JSON line, exit 0 for a job or done and 1 for a stop. */
async function runNext({ layout, config, names, options, nextOptions, io }) {
  // Loaded here and not at the top: the jobs `next` dry-runs load the process and judge-call modules, and `plan`
  // must never load those (plan.test.js checks it). Each line is marked so that check can tell them apart.
  const { readProviderOption } = require('./lib/launch'); // next only
  const { stubLayout } = require('./lib/stub-provider'); // next only
  const { nextStep } = require('./lib/next'); // next only
  if ((options.maxMinutes === undefined) !== (options.startedAt === undefined))
    throw new UsageError(
      '--max-minutes and --started-at go together: the limit counts from the start of the run',
    );
  const maxMinutes =
    options.maxMinutes === undefined
      ? null
      : parseMaxMinutes(options.maxMinutes);
  const startedAtMs =
    options.startedAt === undefined ? null : parseStartedAt(options.startedAt);
  const provider = readProviderOption(options.provider, layout.runId);
  const result = await nextStep({
    // A stub run's limits are read from its own ledger, the one its jobs write (stub-provider.js stubLayout).
    layout: provider === 'stub' ? stubLayout(layout) : layout,
    config,
    skills: names,
    provider,
    maxMinutes,
    startedAtMs,
    maxUsdText: options.maxUsd,
    configFile: options.config && path.resolve(options.config),
    ...nextOptions,
  });
  // The line is JSON, so it is never cut: the one unbounded field, `reason`, is cut before it is serialized (next.js).
  io.out(
    `${redact(JSON.stringify(result), { maxChars: Number.POSITIVE_INFINITY })}\n`,
  );
  return result.next === 'stop' ? 1 : 0;
}

/**
 * The `report` command: writes report.json and report.md and prints one JSON line naming them; exit 0. `nextOptions`
 * may carry `now` (tests) and `armsTmpRoot`.
 */
function runReport({ layout, config, names, options, nextOptions, io }) {
  // Loaded here and not at the top, like the modules of `next`: the judge job module loads the judge client, and
  // `plan` must never load it (plan.test.js checks it). Each line is marked so that check can tell them apart.
  const { readProviderOption } = require('./lib/launch'); // report only
  const { stubLayout } = require('./lib/stub-provider'); // report only
  const { ReportError, writeReport } = require('./lib/run-report'); // report only
  const provider = readProviderOption(options.provider, layout.runId);
  let result;
  try {
    result = writeReport({
      layout,
      config,
      skills: names,
      provider,
      // A stub run books into its own ledger (stub-provider.js stubLayout), so its spend is read from there.
      ledgerFile: (provider === 'stub' ? stubLayout(layout) : layout)
        .ledgerFile,
      ...(nextOptions.now ? { now: nextOptions.now } : {}),
      ...(nextOptions.armsTmpRoot
        ? { armsTmpRoot: nextOptions.armsTmpRoot }
        : {}),
    });
  } catch (error) {
    // A text too long to scan comes from the data the report reads (a task field named in a warning, a record), not from a bug.
    if (error instanceof ReportError) throw new UsageError(error.message);
    throw error;
  }
  io.out(`${redact(JSON.stringify(result), { maxChars: 16000 })}\n`);
  return 0;
}

/**
 * The `trim` command (lib/trim.js): drops the easy tasks of a trusted run from the committed baselines and prints one
 * JSON line. `--run` is required, because the run chosen decides which tasks leave a frozen baseline. `nextOptions`
 * may carry `now` and `collect` (tests). Exit 0 when the baselines are trimmed (or would be), 1 when they do not match
 * MANIFEST.json before or after the trim, 64 for a refusal.
 */
function runTrimCommand({ layout, config, options, nextOptions, io }) {
  // Loaded here and not at the top: trim reads the stored judgments through the report modules, and `plan` must never
  // load them (plan.test.js checks it). Each line is marked so that check can tell them apart.
  const trim = require('./lib/trim'); // report only
  if (options.run === undefined)
    throw new UsageError(
      '--run is required: name the run whose judgments say which tasks are easy',
    );
  const outcome = trim.runTrim({
    layout,
    config,
    skills: options.skills && parseSkillSelection(options.skills),
    threshold:
      options.threshold === undefined
        ? undefined
        : trim.parseThreshold(options.threshold),
    minPerBatch:
      options.minPerBatch === undefined
        ? undefined
        : trim.parseMinPerBatch(options.minPerBatch),
    dryRun: options.dryRun === true,
    listKept: options.listKept === true,
    ...(nextOptions.now ? { now: nextOptions.now } : {}),
    ...(nextOptions.collect ? { collect: nextOptions.collect } : {}),
  });
  if (outcome.result)
    io.out(
      `${redact(JSON.stringify(outcome.result), { maxChars: Number.POSITIVE_INFINITY })}\n`,
    );
  for (const problem of outcome.problems) io.err(`error: ${problem}\n`);
  return outcome.ok ? 0 : 1;
}

if (require.main === module) {
  Promise.resolve(
    main(process.argv.slice(2), {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    }),
  ).then((code) => {
    process.exitCode = code;
  });
}

module.exports = {
  main,
  parseArgs,
  describeFailure,
  isSystemError,
  USAGE,
  EX_USAGE,
  EX_NOINPUT,
  EX_SOFTWARE,
  EX_IOERR,
};
