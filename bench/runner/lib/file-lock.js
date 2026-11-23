// SPDX-License-Identifier: Apache-2.0
'use strict';

// A blocking lock file for short critical sections shared by processes on one host, such as read-check-reserve on a
// spend ledger. The lock file holds the owner's pid; a lock whose pid is gone is taken over.

const fs = require('node:fs');

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * True when the pid written in `file` names no live process. A file with no pid yet (its owner is between create and
 * write) is stale only once it is older than five seconds.
 */
function stale(file) {
  let text;
  let st;
  try { text = fs.readFileSync(file, 'utf8').trim(); st = fs.statSync(file); } catch { return false; }
  const pid = Number(text);
  if (!text || !Number.isInteger(pid) || pid <= 0) return Date.now() - st.mtimeMs > 5000;
  try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
}

/**
 * Runs `fn()` while holding `file` as a lock, and returns its result. Waits up to `timeoutMs` for another holder,
 * then throws. A lock left by a dead process is removed and taken.
 */
function withFileLock(file, fn, { timeoutMs = 60000, pollMs = 50 } = {}) {
  const until = Date.now() + timeoutMs;
  let fd;
  for (;;) {
    try { fd = fs.openSync(file, 'wx', 0o600); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    // shortcut: two waiters that both find a dead owner can both take over; use flock(2) if callers ever crash often.
    if (stale(file)) { fs.rmSync(file, { force: true }); continue; }
    if (Date.now() > until) throw new Error(`could not take the lock ${file} in ${timeoutMs} ms (held by pid ${fs.readFileSync(file, 'utf8').trim()})`);
    sleep(pollMs);
  }
  try {
    fs.writeSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
    return fn();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

module.exports = { withFileLock };
