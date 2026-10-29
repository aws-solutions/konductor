// SPDX-License-Identifier: Apache-2.0
'use strict';

// Registry of live child process groups and scratch dirs, so an interrupted runner
// can stop every agent it started and remove everything holding credentials.

const fs = require('node:fs');

const groups = new Set();
const scratch = new Set();

function trackGroup(pgid) { groups.add(pgid); }
function untrackGroup(pgid) { groups.delete(pgid); }
function trackScratch(dir) { scratch.add(dir); }
function untrackScratch(dir) { scratch.delete(dir); }
function liveGroups() { return [...groups]; }

function killAllGroups(signal = 'SIGKILL') {
  for (const pgid of groups) {
    try { process.kill(-pgid, signal); } catch { /* already gone */ }
  }
}

function removeAllScratch() {
  for (const dir of scratch) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  scratch.clear();
}

/**
 * On SIGHUP, SIGINT or SIGTERM: kill every tracked group, delete scratch dirs (auth copies
 * live inside them), call `flush` to write what already finished, exit non-zero.
 * The handler is synchronous so nothing runs between the kill and the exit.
 * Returns a function that removes the handlers.
 */
function installSignalHandlers({ flush, log = () => {}, exit = process.exit }) {
  const handlers = {};
  for (const [sig, code] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]]) {
    handlers[sig] = () => {
      log(`${sig}: killing ${groups.size} process group(s) and removing scratch dirs`);
      killAllGroups('SIGKILL');
      removeAllScratch();
      try { flush(sig); } catch (e) { log(`flush failed: ${e.message}`); }
      exit(code);
    };
    process.on(sig, handlers[sig]);
  }
  return () => { for (const [sig, h] of Object.entries(handlers)) process.off(sig, h); };
}

module.exports = { trackGroup, untrackGroup, trackScratch, untrackScratch, liveGroups, killAllGroups, removeAllScratch, installSignalHandlers };
