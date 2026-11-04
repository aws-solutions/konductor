// SPDX-License-Identifier: Apache-2.0
'use strict';

// Scratch directories for tests. Every directory made here is removed when the test process exits, whether
// the tests passed, failed or threw, and on SIGINT, SIGTERM and SIGHUP. Tests may remove their directory
// earlier; removing it twice is harmless.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const made = new Set();
let hooked = false;

function cleanup() {
  for (const dir of made) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nothing more to do at exit */ }
  }
  made.clear();
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { cleanup(); process.exit(128 + os.constants.signals[sig]); });
  }
}

/** Like fs.mkdtempSync(path.join(parent, prefix)), plus removal at process exit. parent defaults to os.tmpdir(). */
function mkScratch(prefix, parent = os.tmpdir()) {
  hook();
  const dir = fs.mkdtempSync(path.join(parent, prefix));
  made.add(dir);
  return dir;
}

/** Have a directory made some other way (a child process, a copy) removed at exit too. */
function track(dir) {
  hook();
  made.add(dir);
  return dir;
}

/** lib/sandbox.js makeScratchRoot(), removed at exit too. */
function makeScratchRoot() {
  return track(require('../lib/sandbox.js').makeScratchRoot());
}

module.exports = { mkScratch, makeScratchRoot, track, cleanup };
