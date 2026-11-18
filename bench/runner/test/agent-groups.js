// SPDX-License-Identifier: Apache-2.0
'use strict';

// The agent process groups a run starts, read from the runner's registry (lib/procs.js) at spawn time. A test that
// checks a timed-out agent is gone uses these, not the pid file a fake agent writes once it has booted: on a busy
// host the timeout can kill a fake before it writes that file.

const procs = require('../lib/procs.js');

/** Starts recording every group the runner tracks. Returns `{ pids, restore }`; call `restore` in `finally`. */
function recordGroups() {
  const track = procs.trackGroup;
  const pids = [];
  procs.trackGroup = (pgid) => { pids.push(pgid); track(pgid); };
  return { pids, restore: () => { procs.trackGroup = track; } };
}

/** Whether no process is left in group `pgid`: signal 0 to the group finds none. */
function groupGone(pgid) {
  try { process.kill(-pgid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
}

module.exports = { recordGroups, groupGone };
