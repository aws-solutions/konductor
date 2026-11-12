// SPDX-License-Identifier: Apache-2.0
/**
 * The job launcher: starts one benchmark job as a detached background process and returns at once, so a workflow
 * step that starts paid work does not have to stay open while it runs. scripts/bench/launch.js is its command line.
 *
 * What a launch guarantees:
 *   - The arguments are checked before anything starts (resolveJobRequest): a known job, a valid run id, skills that
 *     exist under the repository root that is given, a settings file that loads, and a plain --max-usd. The job gets
 *     the same values, already checked, as an argument list; nothing passes through a shell.
 *   - The log and the pid file live in the run's private job folder (job-dir.js), mode 0700 with 0600 files.
 *   - One live job per (job, skill). A second launch of the same job and skill list returns the running one with
 *     `already_running: true`, so a rerun of a workflow step cannot start the same paid work twice. A launch that
 *     shares a skill with another live job of the same kind is refused (LaunchRefusedError), because both would run
 *     that skill's pending work. A dry run spends nothing, so it is never refused for an overlap and never blocks one.
 *     The check, the start and the pid file are one step under the launch lock. A pid file whose process is alive but
 *     cannot be checked (no `ps`, no /proc) is not taken for the job and not taken for a stranger: the launch is
 *     refused and starts nothing.
 *   - An earlier log of the same job is renamed aside, never deleted, so the log holds only the current launch.
 *   - The job gets this process's environment with the variables that would redirect or alter a child removed
 *     (child-env.js, no profile: the job resolves its own AWS profile from the settings). No credential is read,
 *     exported or written by the launcher; the job exports fresh credentials before every subject run.
 *
 * Jobs that can be launched (JOBS): `pairs`, the subject runs (pairs.js), `checklists`, the request-only
 * checklists of reading A (checklist-job.js), which also takes a dose ladder (--ladder) whose item names --skills may
 * name, and `judge`, the judge calls of one reading (judge-job.js), which needs --scale items or outcome. A judge job
 * of each scale has its own log and pid file (`judge-items`, `judge-outcome`), so the two readings never stand for
 * each other as "already running".
 */
'use strict';

const fs = require('fs');
const path = require('path');

const proc = require('./proc');
const { childEnv } = require('./child-env');
const {
  UsageError,
  parseFlags,
  parseMaxUsd,
  parseSkillSelection,
} = require('./cli-args');
const { loadConfig, ConfigError } = require('./config');
const { itemNames, loadLadder, validateLadder } = require('./dose-ladder');
const jobDir = require('./job-dir');
const { REPO_ROOT, SCALES, createLayout } = require('./layout');
const { listSkills } = require('./skills');
const {
  PROVIDERS,
  assertStubRun,
  isStubRun,
  stubLayout,
} = require('./stub-provider');

/** The script every job runs in: `node scripts/bench/job.js <job> ...`. Its path is how a live job is recognised. */
const JOB_SCRIPT = path.join(__dirname, '..', 'job.js');

/** The jobs the launcher can start, with what each one does. `ladder`: the job also takes --ladder <file>. `scale`:
 * the job needs --scale items|outcome, and a job of each scale is a job of its own (its own log and pid file). */
const JOBS = Object.freeze({
  pairs: Object.freeze({
    summary: 'subject runs with and without the skill (paid)',
    ladder: false,
    scale: false,
  }),
  checklists: Object.freeze({
    summary: 'request-only checklists for reading A (paid)',
    ladder: true,
    scale: false,
  }),
  judge: Object.freeze({
    summary: 'judge calls of one reading: --scale items or outcome (paid)',
    ladder: false,
    scale: true,
  }),
});

/** A launch that is valid but cannot start now: another live job holds one of its skills, or the lock is busy. */
class LaunchRefusedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LaunchRefusedError';
  }
}

/**
 * Checks the options of a job command and returns the request:
 *   { job, skills, layout, config, maxUsdText, configFile, ladder, ladderFile, scale, provider }
 * `options` holds the text of the flags: skills, run, maxUsd, config, root, ladder, scale, provider. `ladder` (a job
 * whose JOBS row has `ladder` set) is a dose ladder file that passes its audit; it comes back parsed as `ladder`, with
 * its absolute path as `ladderFile`, both null without the flag. `skills` comes back sorted and without repeats.
 * `scale` is the reading of a judge job and null for every other job. Throws UsageError for
 * anything that is not acceptable. Shared by the launcher and the job itself, so the job accepts exactly what the
 * launcher accepted.
 */
function resolveJobRequest(job, options = {}) {
  if (!job)
    throw new UsageError(`name a job: one of ${Object.keys(JOBS).join(', ')}`);
  if (!Object.hasOwn(JOBS, job))
    throw new UsageError(
      `unknown job "${job}"; jobs: ${Object.keys(JOBS).join(', ')}`,
    );
  const maxUsd =
    options.maxUsd === undefined ? undefined : parseMaxUsd(options.maxUsd);
  const configFile = options.config ? path.resolve(options.config) : undefined;
  let layout;
  let config;
  try {
    layout = createLayout({
      root: options.root ? path.resolve(options.root) : REPO_ROOT,
      runId: options.run,
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  // A wrong --root is named before its missing settings file, which would only be a symptom of it (as in bench.js).
  if (!fs.existsSync(layout.skillsDir))
    throw new UsageError(
      `the repository root ${layout.root} has no skills/ folder`,
    );
  try {
    config = loadConfig({
      defaultFile: layout.configFile,
      file: configFile,
      overrides: maxUsd === undefined ? undefined : { max_usd: maxUsd },
    });
  } catch (error) {
    // A settings problem is the user's to fix (a UsageError, exit 64); anything else is a bug and is rethrown.
    if (!(error instanceof ConfigError)) throw error;
    throw new UsageError(error.message);
  }
  if (!options.skills)
    throw new UsageError('--skills is required: name the skills to run');
  const { ladder, ladderFile } = readLadderOption(job, options.ladder);
  const scale = readScaleOption(job, options.scale);
  const provider = readProviderOption(options.provider, layout.runId);
  const names = parseSkillSelection(options.skills);
  const knownSkills = [
    ...listSkills(layout.skillsDir),
    ...(ladder ? itemNames(ladder) : []),
  ];
  const unknownSkills = names.filter((name) => !knownSkills.includes(name));
  if (unknownSkills.length)
    throw new UsageError(
      `unknown skill(s) in --skills: ${unknownSkills.join(', ')} (no skills/<name>/SKILL.md under ${layout.root}${ladder ? ', and not an item of the dose ladder' : ''})`,
    );
  try {
    jobDir.jobKey(names);
  } catch {
    throw new UsageError(
      '--skills: a skill name may hold only lowercase letters, digits and "-"',
    );
  }
  return {
    job,
    skills: [...names].sort(),
    // A stub run books made-up dollars, so it keeps its own ledger (stub-provider.js stubLayout).
    layout: provider === 'stub' ? stubLayout(layout) : layout,
    config,
    maxUsdText: maxUsd === undefined ? undefined : options.maxUsd,
    configFile,
    ladder,
    ladderFile,
    scale,
    provider,
  };
}

/** The flags of a job command, as parseFlags reads them. The launcher and the job take the same flags. */
const VALUE_FLAGS = Object.freeze({
  '--skills': 'skills',
  '--run': 'run',
  '--max-usd': 'maxUsd',
  '--config': 'config',
  '--root': 'root',
  '--ladder': 'ladder',
  '--scale': 'scale',
  '--provider': 'provider',
});
const BOOL_FLAGS = Object.freeze({
  '--dry-run': 'dryRun',
  '--help': 'help',
  '-h': 'help',
});

/**
 * Reads the words of a job command (`<job> [flags]`) the way both entry points do: no job name, `--help` or `-h`
 * answers `{ help: true }`; otherwise the result is { job, options, request }, where `options` is what parseFlags read
 * and `request` is resolveJobRequest of the two. Throws UsageError for a first word that is a flag, a flag that is
 * unknown, repeated or without a value, and for anything resolveJobRequest refuses.
 */
function parseJobCommand(argv) {
  const [job, ...rest] = argv;
  if (!job || job === '--help' || job === '-h') return { help: true };
  if (job.startsWith('-'))
    throw new UsageError(`the first word must be a job name, got ${job}`);
  const options = parseFlags(rest, {
    valueFlags: VALUE_FLAGS,
    boolFlags: BOOL_FLAGS,
  });
  if (options.help) return { help: true };
  return { job, options, request: resolveJobRequest(job, options) };
}

/**
 * The --provider option: `live` (the default, the real CLIs) or `stub` (stub-provider.js, no model call). The two are
 * kept apart by the run id: the stub is refused outside a stub run id, so made-up answers can never land in a run that
 * holds real ones, and the live provider, given or by default, is refused in a stub run id, because a live job would
 * read the stub answers, checklists and judgments there as current and build a real report on them.
 */
function readProviderOption(value, runId) {
  if (value !== undefined && !PROVIDERS.includes(value))
    throw new UsageError(
      `--provider must be one of ${PROVIDERS.join(', ')}, got ${JSON.stringify(value)}`,
    );
  const provider = value === undefined ? 'live' : value;
  if (provider === 'live' && isStubRun(runId))
    throw new UsageError(
      `the run id ${JSON.stringify(runId)} is a stub run, which holds made-up answers and judgments, so it takes --provider stub only; for real work pick another run id`,
    );
  if (provider === 'stub') {
    try {
      assertStubRun(runId);
    } catch (error) {
      throw new UsageError(error.message);
    }
  }
  return provider;
}

/** The --scale option: required for a job that takes one (JOBS[job].scale), refused for the others; null then. */
function readScaleOption(job, value) {
  if (!JOBS[job].scale) {
    if (value !== undefined)
      throw new UsageError(`--scale is not an option of the ${job} job`);
    return null;
  }
  if (value === undefined)
    throw new UsageError(
      `--scale is required for the ${job} job: ${SCALES.join(' (reading B) or ')} (reading A)`,
    );
  if (!SCALES.includes(value))
    throw new UsageError(
      `--scale must be one of ${SCALES.join(', ')}, got ${JSON.stringify(value)}`,
    );
  return value;
}

/** The job name in the job folder: `<job>-<scale>` for a job that takes a scale, so each reading has its own files. */
const fileJobName = (request) =>
  request.scale ? `${request.job}-${request.scale}` : request.job;

/**
 * The --ladder option: { ladder, ladderFile } for a job that takes one (JOBS[job].ladder), or nulls without it.
 * The file must read as JSON and pass the dose ladder's audit, so the job is given only item names that exist.
 */
function readLadderOption(job, value) {
  if (value === undefined) return { ladder: null, ladderFile: null };
  if (!JOBS[job].ladder)
    throw new UsageError(`--ladder is not an option of the ${job} job`);
  const ladderFile = path.resolve(value);
  let ladder;
  try {
    ladder = loadLadder(ladderFile);
  } catch (error) {
    throw new UsageError(`--ladder: ${error.message}`);
  }
  const audit = validateLadder(ladder);
  if (!audit.ok)
    throw new UsageError(
      `--ladder ${ladderFile} fails the dose ladder audit: ${audit.problems.slice(0, 3).join('; ')}`,
    );
  return { ladder, ladderFile };
}

/** Why a launch stops at a pid file whose process is alive but cannot be checked (job-dir.js PROCESS_UNVERIFIED). */
function unverifiedMessage(record) {
  return `pid ${record.pid} (${path.basename(record.file)}) is alive but its command line cannot be read, so it cannot be told whether it is the job; nothing was started. Remove ${record.file} if that process is not the job`;
}

/** The arguments the job is started with: the checked request, with absolute paths. */
function jobArguments(request, { dryRun }) {
  return [
    request.job,
    '--skills',
    request.skills.join(','),
    '--run',
    request.layout.runId,
    '--root',
    request.layout.root,
    ...(request.maxUsdText === undefined
      ? []
      : ['--max-usd', request.maxUsdText]),
    ...(request.configFile ? ['--config', request.configFile] : []),
    ...(request.ladderFile ? ['--ladder', request.ladderFile] : []),
    ...(request.scale ? ['--scale', request.scale] : []),
    ...(request.provider === 'stub' ? ['--provider', 'stub'] : []),
    ...(dryRun ? ['--dry-run'] : []),
  ];
}

/**
 * Stops the job that was just started (`pid` leads its own process group, see proc.startDetached) when its pid
 * record could not be written. Without a record no later launch can see the job, so a retry would start the same
 * job again. A group that is already gone is fine. If the group cannot be signalled, the caller's error (`cause`) says
 * which job is still running, so that nobody starts it twice by hand.
 */
function stopUntracked(pid, cause, kill) {
  try {
    kill(-pid, 'SIGTERM');
  } catch (error) {
    if (error.code === 'ESRCH') return;
    cause.message += ` (the job that was started, pid ${pid}, is running without a pid file and could not be stopped: ${error.message})`;
  }
}

/**
 * Starts the job of `request` (resolveJobRequest) in the background, or finds it already running. Returns
 *   { job, run_id, skills, dry_run, pid, already_running, log_file, pid_file }
 * Throws LaunchRefusedError when another live job of the same kind holds one of the skills, a pid file names a
 * process that cannot be checked, or the launch lock stays busy. Options for tests: `start` (proc.startDetached),
 * `kill` (process.kill), `jobScript`, `baseEnv`, `now`, `processCheck` (passed to processState), `lock` (passed to
 * withLaunchLock).
 */
function launchJob(
  request,
  {
    dryRun = false,
    start = proc.startDetached,
    kill = process.kill,
    jobScript = JOB_SCRIPT,
    baseEnv = process.env,
    now = Date.now,
    processCheck = {},
    lock = {},
  } = {},
) {
  const { job, skills, layout } = request;
  const fileJob = fileJobName(request);
  const dir = jobDir.ensureJobDir(layout.jobsDir);
  const key = jobDir.jobKey(skills);
  const logFile = jobDir.logFile(dir, fileJob, key, { dryRun });
  const pidFile = jobDir.pidFile(dir, fileJob, key, { dryRun });
  const result = (pid, alreadyRunning) => ({
    job,
    ...(request.scale ? { scale: request.scale } : {}),
    run_id: layout.runId,
    skills,
    dry_run: dryRun,
    pid,
    already_running: alreadyRunning,
    log_file: logFile,
    pid_file: pidFile,
  });
  const launch = () => {
    const live = jobDir.liveJobs(dir, fileJob, jobScript, processCheck);
    const same = live.find((record) => record.file === pidFile);
    if (same) {
      if (same.unverified)
        throw new LaunchRefusedError(unverifiedMessage(same));
      return result(same.pid, true);
    }
    if (!dryRun)
      for (const record of live) {
        if (record.dry_run) continue;
        const shared = record.skills.filter((skill) => skills.includes(skill));
        if (!shared.length) continue;
        if (record.unverified)
          throw new LaunchRefusedError(unverifiedMessage(record));
        throw new LaunchRefusedError(
          `a ${job} job for ${shared.join(', ')} is already running (pid ${record.pid}, ${path.basename(record.file)}); wait for it to end, or start other skills`,
        );
      }
    jobDir.setLogAside(logFile);
    const args = jobArguments(request, { dryRun });
    const outputFd = fs.openSync(logFile, 'wx', 0o600);
    let pid;
    try {
      pid = start(process.execPath, [jobScript, ...args], {
        cwd: layout.root,
        env: childEnv({ base: baseEnv }),
        outputFd,
      });
    } finally {
      fs.closeSync(outputFd);
    }
    try {
      jobDir.writePidRecord(pidFile, {
        pid,
        // The job folder's name for it: liveJobs finds a judge job of one scale by `judge-<scale>`.
        job: fileJob,
        ...(request.scale ? { scale: request.scale } : {}),
        key,
        skills,
        run_id: layout.runId,
        dry_run: dryRun,
        script: jobScript,
        args,
        started: new Date(now()).toISOString(),
      });
    } catch (error) {
      stopUntracked(pid, error, kill);
      throw error;
    }
    return result(pid, false);
  };
  try {
    return jobDir.withLaunchLock(dir, launch, lock);
  } catch (error) {
    if (error instanceof jobDir.LaunchLockError)
      throw new LaunchRefusedError(error.message);
    throw error;
  }
}

module.exports = {
  JOB_SCRIPT,
  JOBS,
  LaunchRefusedError,
  VALUE_FLAGS,
  BOOL_FLAGS,
  resolveJobRequest,
  parseJobCommand,
  readProviderOption,
  fileJobName,
  jobArguments,
  launchJob,
};
