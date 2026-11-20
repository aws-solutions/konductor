// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runner reads each task's fixture and hidden tests from the checkout when the run starts, minutes or hours after
// the command did. A branch switch in between would hand the agent other files than the plan recorded. The command
// hashes them when it starts, and each run checks its task's hash before it copies anything.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { helpersHash, LIB_DIR } = require('./hidden-lib.js');

/** Hash over relative paths, symlink targets and bytes of everything under `dir`; null when `dir` does not exist. */
function hashDir(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const h = crypto.createHash('sha256');
  const visit = (abs, rel) => {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) h.update(`l\0${rel}\0${fs.readlinkSync(abs)}\0`);
    else if (st.isDirectory()) for (const n of fs.readdirSync(abs).sort()) visit(path.join(abs, n), rel ? `${rel}/${n}` : n);
    else if (st.isFile()) h.update(`f\0${rel}\0`).update(fs.readFileSync(abs)).update('\0');
  };
  visit(dir, '');
  return h.digest('hex');
}

// Real tasks are built from a pinned commit in the real-repo cache and checked against that pin, so they are left out.
const inputsOf = (task) => (task.real ? [] : [['fixture', task.fixtureDir], ['hidden', task.hiddenDir]].filter(([, d]) => d));

// The shared hidden helpers a task's hidden dir names (hidden-lib.js) are inputs too.
function hashTask(task) {
  const out = Object.fromEntries(inputsOf(task).map(([k, d]) => [k, hashDir(d)]));
  const lib = task.real ? null : helpersHash(task.hiddenDir);
  if (lib) out.hiddenLib = lib;
  return out;
}
const inputDir = (task, k) => (k === 'hiddenLib' ? LIB_DIR : inputsOf(task).find(([n]) => n === k)[1]);

/** Hashes every task's inputs now. `check(task)` throws when they changed since. */
function snapshotTaskInputs(tasks) {
  const at = new Map(tasks.map((t) => [t.id, hashTask(t)]));
  return {
    hashes: () => Object.fromEntries(at),
    check(task) {
      const was = at.get(task.id);
      if (!was) return;
      const now = hashTask(task);
      const changed = Object.keys(was).filter((k) => was[k] !== now[k]);
      if (changed.length) throw new Error(`bench files of task ${task.id} changed since this command started (${changed.map((k) => `${k} ${inputDir(task, k)}`).join(', ')}); the checkout under the runner moved, so the run is not started`);
    },
  };
}

module.exports = { snapshotTaskInputs, hashDir };
