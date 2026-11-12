// SPDX-License-Identifier: Apache-2.0
/**
 * The private job folder of a run: bench/out/<run-id>/jobs/ (layout.js `jobsDir`). It holds the log and the pid
 * file of every job the launcher started for that run. The folder is mode 0700 and every file in it 0600, because
 * a job log can quote a task or an error that the redactor did not know to remove. Nothing goes to the shared /tmp.
 *
 * One log and one pid file per (job, skill list):
 *
 *   <job>.<key>.log            what the job printed (stdout and stderr together)
 *   <job>.<key>.pid            the pid record of the job that writes that log
 *   <job>.<key>.dry-run.log    the same for a --dry-run launch, which spends nothing, so it is a job of its own
 *   <job>.<key>.log.<time>     an earlier log, set aside (never deleted) when the same job is started again
 *
 * The key is the sorted skill names joined with "+" (jobKey), so the same set of skills is the same job whatever
 * order it was typed in. A skill name holds only lowercase letters, digits and "-", so "+" and "." cannot be part of
 * one. Two different lists of KEY_MAX_CHARS characters or fewer never make the same key; a longer list is cut to its
 * first three names and a digest, so two such lists share a key only when their first three names, their count and
 * the first 8 hex digits of their SHA-256 agree.
 *
 * A pid file does not prove the job is alive: the job may have exited, and the system may have given its pid to
 * another process since. processState checks that the pid is alive AND that its command line holds the job
 * script's path, and says so when it cannot check. The launcher takes the launch lock (withLaunchLock) around "check
 * the live jobs, start, write the pid file", so two launches started together cannot both decide that nothing is
 * running.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const proc = require('./proc');

const JOB_NAME = /^[a-z][a-z-]{0,31}$/;
const KEY_SKILL = /^[a-z0-9][a-z0-9-]{0,127}$/;
/**
 * A key longer than this keeps its first three names and a digest of the whole list, so file names stay short. They
 * stay under the 255 characters a file name may have unless those three names are themselves long (a skill name may
 * hold 128): a launch for such a list fails when its log is created, and starts nothing.
 */
const KEY_MAX_CHARS = 64;
const DRY_RUN_MARK = 'dry-run';
const PID_SUFFIX = '.pid';
const LAUNCH_LOCK = 'launch.lock';
/** The lock is held for the few milliseconds a launch takes; one older than this was left by a crashed launcher. */
const LAUNCH_LOCK_STALE_MS = 30000;
const LAUNCH_LOCK_TIMEOUT_MS = 10000;
const LOCK_POLL_MS = 50;
const PS_TIMEOUT_MS = 5000;

/** The launch lock was held by another launch for longer than the wait allows. Nothing was started. */
class LaunchLockError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LaunchLockError';
  }
}

function requireJobName(job) {
  if (typeof job !== 'string' || !JOB_NAME.test(job))
    throw new Error(`job-dir: unsafe job name ${JSON.stringify(job)}`);
  return job;
}

/** Creates the folder if needed and forces mode 0700, also on a folder that an earlier run made with a looser mode. */
function ensureJobDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

/**
 * The key of a skill list: the sorted, distinct names joined with "+". A key longer than KEY_MAX_CHARS keeps the
 * first three names, the count of the others and the first 8 hex digits of the SHA-256 of the full key.
 */
function jobKey(skills) {
  if (!Array.isArray(skills) || !skills.length)
    throw new Error('job-dir: a job key needs at least one skill');
  for (const name of skills)
    if (typeof name !== 'string' || !KEY_SKILL.test(name))
      throw new Error(
        `job-dir: unsafe skill name for a job key: ${JSON.stringify(name)}`,
      );
  const names = [...new Set(skills)].sort();
  const joined = names.join('+');
  if (joined.length <= KEY_MAX_CHARS) return joined;
  const digest = crypto
    .createHash('sha256')
    .update(joined)
    .digest('hex')
    .slice(0, 8);
  return `${names.slice(0, 3).join('+')}+and-${names.length - 3}-more-${digest}`;
}

const baseName = (job, key, dryRun) =>
  `${requireJobName(job)}.${key}${dryRun ? `.${DRY_RUN_MARK}` : ''}`;
const logFile = (dir, job, key, { dryRun = false } = {}) =>
  path.join(dir, `${baseName(job, key, dryRun)}.log`);
const pidFile = (dir, job, key, { dryRun = false } = {}) =>
  path.join(dir, `${baseName(job, key, dryRun)}${PID_SUFFIX}`);

/** The pid record in `file`, or null when there is none or it is not a pid record. */
function readPidRecord(file) {
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const valid =
    record !== null &&
    typeof record === 'object' &&
    Number.isInteger(record.pid) &&
    typeof record.job === 'string' &&
    Array.isArray(record.skills);
  return valid ? record : null;
}

/** Writes `record` to `file` (mode 0600) through a temporary file, so a reader never sees half a record. */
function writePidRecord(file, record) {
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/** The pid is alive and its command line holds the job script. */
const PROCESS_RUNNING = 'running';
/** The pid is not alive, or it is another program's (its command line does not hold the job script). */
const PROCESS_NOT_RUNNING = 'not-running';
/** The pid is alive but its command line could not be read by `ps` or from /proc, so it cannot be told. */
const PROCESS_UNVERIFIED = 'unverified';

/** True when signal 0 reaches `pid`. EPERM means the process exists and belongs to another user. */
function isAlive(pid, kill) {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * The command line of `pid` as text, or null when it cannot be read. `ps` is asked first; when it cannot run (not
 * installed, not on PATH) or gives no answer, /proc/<pid>/cmdline is read, where there is one. An empty command line
 * (a zombie, a kernel thread) is a command line that holds nothing.
 */
function readCommandLine(pid, { runSync, readFile }) {
  const listing = runSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], {
    timeoutMs: PS_TIMEOUT_MS,
  });
  if (!listing.error && listing.status === 0 && String(listing.stdout).trim())
    return String(listing.stdout);
  try {
    return String(readFile(`/proc/${pid}/cmdline`, 'utf8'))
      .split('\0')
      .join(' ');
  } catch {
    return null;
  }
}

/**
 * What `pid` is, for a job whose command line holds `needle`: PROCESS_RUNNING, PROCESS_NOT_RUNNING (it exited, or
 * the system gave its pid to another program since) or PROCESS_UNVERIFIED (it is alive and its command line cannot be
 * read, so nothing says whether it is the job). The caller decides what an unverified process means: the launcher
 * refuses to start, because answering "running" for a process that may be another program, and starting a second
 * paid job, are both wrong.
 */
function processState(
  pid,
  needle,
  {
    runSync = proc.runSync,
    kill = process.kill,
    readFile = fs.readFileSync,
  } = {},
) {
  if (!Number.isInteger(pid) || pid <= 1) return PROCESS_NOT_RUNNING;
  if (typeof needle !== 'string' || !needle) return PROCESS_NOT_RUNNING;
  if (!isAlive(pid, kill)) return PROCESS_NOT_RUNNING;
  const commandLine = readCommandLine(pid, { runSync, readFile });
  if (commandLine === null)
    // The process may have ended between the signal and the read.
    return isAlive(pid, kill) ? PROCESS_UNVERIFIED : PROCESS_NOT_RUNNING;
  return commandLine.includes(needle) ? PROCESS_RUNNING : PROCESS_NOT_RUNNING;
}

/**
 * The pid records in `dir` of `job` processes that are live (processState says running) or cannot be checked
 * (unverified: the record then has `unverified: true`), each with its `file`. A pid file that cannot be read, or
 * whose process is gone, is not a live job.
 */
function liveJobs(dir, job, needle, processCheck = {}) {
  requireJobName(job);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const live = [];
  for (const name of names
    .filter((entry) => entry.endsWith(PID_SUFFIX))
    .sort()) {
    const file = path.join(dir, name);
    const record = readPidRecord(file);
    if (!record || record.job !== job) continue;
    const state = processState(record.pid, needle, processCheck);
    if (state === PROCESS_RUNNING) live.push({ ...record, file });
    else if (state === PROCESS_UNVERIFIED)
      live.push({ ...record, file, unverified: true });
  }
  return live;
}

/**
 * Renames the log `file` to `<file>.<time>` (the time it was last written) and returns the new path, or null when
 * there is no log. A name that is already taken gets `-2`, `-3`, ..., so no kept log is overwritten.
 */
function setLogAside(file) {
  let modified;
  try {
    modified = fs.statSync(file).mtimeMs;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const base = `${file}.${new Date(modified).toISOString().replace(/[:.]/g, '-')}`;
  let target = base;
  for (let suffix = 2; fs.existsSync(target); suffix++)
    target = `${base}-${suffix}`;
  fs.renameSync(file, target);
  return target;
}

const sleepSync = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Takes the stale lock `lockFile` out of the way by renaming it to `aside`, a name only this launcher uses. When two
 * launchers read the same stale lock, one rename succeeds and the other finds no file and returns. A launcher whose
 * rename came after the winner had already created its fresh lock holds that fresh lock under `aside`, which is not
 * stale; it links the lock back under its own name before it returns, so the lock of the winner is not deleted.
 * If a third launcher created a lock in that instant, the winner's file is gone and its release leaves the new
 * lock alone, as the token check requires.
 */
function removeStaleLock(lockFile, aside, { now, staleMs }) {
  try {
    fs.renameSync(lockFile, aside);
  } catch (error) {
    if (error.code === 'ENOENT') return; // another launcher took it out of the way first
    throw error;
  }
  try {
    if (now() - fs.statSync(aside).mtimeMs <= staleMs) {
      try {
        fs.linkSync(aside, lockFile);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
  } finally {
    fs.rmSync(aside, { force: true });
  }
}

/**
 * Runs `callback()` (synchronous) while holding the launch lock of `dir`: a lock file made with exclusive create.
 * A lock older than `staleMs` was left by a launcher that crashed; it is taken out of the way (see
 * removeStaleLock) and the exclusive create is tried again. A launch that cannot take the lock within `timeoutMs`
 * throws LaunchLockError and starts nothing. The lock file holds a token, and it is removed at the end only while it
 * still holds this holder's token.
 */
function withLaunchLock(
  dir,
  callback,
  {
    now = Date.now,
    sleep = sleepSync,
    staleMs = LAUNCH_LOCK_STALE_MS,
    timeoutMs = LAUNCH_LOCK_TIMEOUT_MS,
  } = {},
) {
  const lockFile = path.join(dir, LAUNCH_LOCK);
  const token = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  const started = now();
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockFile, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let ageMs;
      try {
        ageMs = now() - fs.statSync(lockFile).mtimeMs;
      } catch (statError) {
        if (statError.code === 'ENOENT') continue; // released between the two calls
        throw statError;
      }
      if (ageMs > staleMs) {
        removeStaleLock(lockFile, `${lockFile}.stale-${token}`, {
          now,
          staleMs,
        });
        continue;
      }
      if (now() - started >= timeoutMs)
        throw new LaunchLockError(
          `another launch holds ${lockFile}; nothing was started. Try again, or remove the file if no launch is running`,
        );
      sleep(LOCK_POLL_MS);
    }
  }
  const holdsLock = () => {
    try {
      return fs.readFileSync(lockFile, 'utf8') === token;
    } catch {
      return false;
    }
  };
  try {
    fs.writeSync(descriptor, token);
    return callback();
  } finally {
    fs.closeSync(descriptor);
    if (holdsLock()) fs.rmSync(lockFile, { force: true });
  }
}

module.exports = {
  DRY_RUN_MARK,
  KEY_MAX_CHARS,
  LAUNCH_LOCK,
  LaunchLockError,
  ensureJobDir,
  jobKey,
  logFile,
  pidFile,
  readPidRecord,
  writePidRecord,
  PROCESS_NOT_RUNNING,
  PROCESS_RUNNING,
  PROCESS_UNVERIFIED,
  processState,
  liveJobs,
  setLogAside,
  withLaunchLock,
};
