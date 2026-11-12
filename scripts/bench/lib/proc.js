// SPDX-License-Identifier: Apache-2.0
/**
 * Minimal spawn helper: no shell, hard timeout (SIGKILL), optional stdin payload, capped output.
 * Resolves with { code, stdout, stderr, ms, timedOut, overflow } and never rejects on a non-zero exit,
 * so callers can record the failure before deciding what to do. A command that cannot be started
 * resolves with code -1 and a `spawn error: ...` line in stderr. `runSync` is the same for a short command
 * that the caller must wait for.
 *
 * Process-wide side effect: the first run() installs an 'exit' hook and SIGINT, SIGTERM and SIGHUP handlers that kill
 * the children still running (see installExitHooks), so a host that has its own signal handlers should know.
 *
 * GOTCHA: `opencode run` finds its project config (opencode.json, which carries the Bedrock provider and
 * the judge lockdown) from the PWD environment variable, not from process.cwd(). Node's spawn({ cwd })
 * changes the directory but leaves the parent's PWD in the environment, so OpenCode silently ignores the
 * config and fails with a misleading "provider.no-route / Model unavailable". A shell (`cd dir && opencode
 * ...`) sets PWD itself, which is why the same command works by hand. This helper therefore sets PWD to cwd.
 */
'use strict';

const { spawn, spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 300000;
// The longest delay setTimeout takes; a larger one fires after 1 ms, so every such call would be killed at once.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
// After a kill, how long run waits for the output pipes to close before it resolves anyway. A grandchild
// that inherited the pipes (a helper server) keeps them open after its parent is dead, and the call must
// still end near its timeout.
const DEFAULT_KILL_GRACE_MS = 2000;
// A child that prints more than this is killed: a judge reply is a few kilobytes, so a flood means
// something is wrong, and holding it all would grow this process without bound.
const DEFAULT_MAX_OUTPUT_CHARS = 32 * 1024 * 1024;

// A child leads its own process group (it is spawned detached, except on Windows), so killing it also kills the helper
// processes it started: OpenCode starts a private server per call, and a server left running after a timeout would
// keep the exported credentials and could finish, and bill, a request nobody waits for.
const ownProcessGroup = process.platform !== 'win32';

/** SIGKILL for `child` and, where it leads a process group, for every process in that group. */
function killChild(child) {
  try {
    if (ownProcessGroup && Number.isInteger(child.pid)) {
      process.kill(-child.pid, 'SIGKILL');
      return;
    }
  } catch {
    /* the group is already gone, or the signal was refused: signal the child itself below */
  }
  try {
    child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

// Children still running when this process exits (an abort thrown from one pool worker, a SIGTERM, a hangup) must
// not be left behind: a stale model process holding old credentials keeps calling the provider.
const liveChildren = new Set();
const killLiveChildren = () => {
  for (const child of liveChildren) killChild(child);
};
let exitHooksInstalled = false;
/**
 * Installed once, by the first run(): an 'exit' hook that kills the live children, and a SIGINT, a SIGTERM and a SIGHUP
 * handler. SIGHUP is what a dropped ssh session or a closed terminal sends: the terminal signals its foreground process
 * group, which does not include a child in its own group, and Node ends on an unhandled SIGHUP without running the
 * 'exit' hook. The handler kills the live children and then ends the process with the usual code (130, 143, 129) only
 * when it is the one listener for the signal. A host that registers its own handler owns shutdown (it may flush a
 * ledger or write run state first): its handler runs too, and the children are already gone whether it exits or not.
 */
function installExitHooks() {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.on('exit', killLiveChildren);
  for (const [signal, exitCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ])
    process.on(signal, () => {
      killLiveChildren();
      if (process.listenerCount(signal) === 1) process.exit(exitCode);
    });
}

/**
 * Runs `command` with `args` (an array; no shell). `env` replaces the environment whole (default
 * process.env). `stdin`, when given, is written and closed. Output beyond `maxOutputChars` (stdout and
 * stderr together) kills the child and sets `overflow`. The kill is SIGKILL to the child's whole process group, so
 * the helpers it started die with it. After a kill (timeout or overflow) the result is returned once the pipes close,
 * or `killGraceMs` later if a process that left the group (its own session) and inherited the pipes keeps them open;
 * such a process is not killed.
 */
function run(
  command,
  args,
  {
    cwd,
    env,
    stdin,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
  } = {},
) {
  if (!Array.isArray(args))
    throw new TypeError('run: args must be an array of strings');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('run: timeoutMs must be a number above 0');
  if (timeoutMs > MAX_TIMEOUT_MS)
    throw new RangeError(`run: timeoutMs must be at most ${MAX_TIMEOUT_MS}`);
  if (!Number.isFinite(killGraceMs) || killGraceMs <= 0)
    throw new TypeError('run: killGraceMs must be a number above 0');
  installExitHooks();
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const childEnvironment = { ...(env || process.env) };
    if (cwd) childEnvironment.PWD = cwd;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let overflow = false;
    let settled = false;
    let child;
    let graceTimer;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (child) liveChildren.delete(child);
      clearTimeout(timer);
      clearTimeout(graceTimer);
      resolve({
        code,
        stdout,
        stderr,
        ms: Date.now() - startedAt,
        timedOut,
        overflow,
      });
    };
    const stopChild = () => {
      if (!child) return;
      killChild(child);
      graceTimer ??= setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null);
      }, killGraceMs);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, timeoutMs);
    try {
      child = spawn(command, args, {
        cwd,
        env: childEnvironment,
        detached: ownProcessGroup,
        stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      // spawn throws synchronously for a bad argument (a NUL byte, an argument list the OS refuses).
      stderr += `spawn error: ${error.message}`;
      finish(-1);
      return;
    }
    liveChildren.add(child);
    const collect = (stream, append) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        if (overflow) return;
        if (stdout.length + stderr.length + chunk.length > maxOutputChars) {
          overflow = true;
          stopChild();
          return;
        }
        append(chunk);
      });
    };
    collect(child.stdout, (chunk) => (stdout += chunk));
    collect(child.stderr, (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      stderr += `spawn error: ${error.message}`;
      finish(-1);
    });
    child.on('close', (code) => finish(code));
    if (stdin !== undefined) {
      child.stdin.on('error', () => {}); // the child may exit before reading it all
      child.stdin.end(stdin);
    }
  });
}

/**
 * Runs `command` with `args` (no shell) and waits for it. For short, read-only commands such as `ps`. Returns
 * { status, stdout, error }: `status` is null and `error` is set when the command could not be started or ran past
 * `timeoutMs` (it is then killed with SIGKILL). Never throws for a failing command.
 */
function runSync(command, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!Array.isArray(args))
    throw new TypeError('runSync: args must be an array of strings');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('runSync: timeoutMs must be a number above 0');
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  return {
    status: result.error ? null : result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    error: result.error || null,
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_KILL_GRACE_MS,
  MAX_TIMEOUT_MS,
  run,
  runSync,
};
