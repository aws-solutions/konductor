// SPDX-License-Identifier: Apache-2.0
'use strict';

// Negative controls for a task's checks, used by validate-tasks.js.
//   empty workspace:  a check that passes with nothing in the workspace proves nothing (a cmd that counts zero files,
//                     a test runner that finds no tests). Every check must fail there.
//   deleted file:     in the solved workspace, delete each file the solution provides, one at a time. When every check
//                     still passes, nothing notices that file is gone.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else out.push(path.relative(base, p));
  }
  return out.sort();
}

const scratch = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Indexes of the checks that pass in an empty directory. evalOne(dir, check) returns true when the check passes. */
function passingOnEmpty(task, evalOne) {
  const dir = scratch('bench-empty-');
  try {
    return task.checks.map((c, i) => (evalOne(dir, c) ? i : -1)).filter((i) => i >= 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Files of the solution overlay whose deletion from the solved workspace leaves every check passing.
 * makeSolved() returns a fresh solved workspace; evalOne(dir, check) returns true when the check passes.
 */
function deletionGaps(task, overlayDir, makeSolved, evalOne) {
  const gaps = [];
  for (const rel of listFiles(overlayDir)) {
    const dir = makeSolved();
    try {
      fs.rmSync(path.join(dir, rel), { force: true });
      if (task.checks.every((c) => evalOne(dir, c))) gaps.push(rel);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  return gaps;
}

module.exports = { passingOnEmpty, deletionGaps, listFiles };
