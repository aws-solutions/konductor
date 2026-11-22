// SPDX-License-Identifier: Apache-2.0
'use strict';

// Process helpers for hidden tests that replay an agent's work on a copy of the repository (the T12 delegation tasks
// t12-handoff-export-dates and t12-parallel-backlog; DEBT D-120). A task's .bench-lib.json copies this file in, and
// maps ".bench-base" to "@pristine" for the untouched fixture to compare against.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** Every regular file under `dir`/`rel`, as paths relative to `dir` with / separators; [] when it is missing. */
function files(dir, rel = '') {
  const out = [];
  if (!fs.existsSync(path.join(dir, rel))) return out;
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...files(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** Runs node with `args` in `cwd`, outside the calling test runner (NODE_TEST_CONTEXT dropped), 12 s at most. */
function node(args, cwd, env = {}) {
  const { NODE_TEST_CONTEXT, ...rest } = process.env;
  return spawnSync(process.execPath, args, { cwd, env: { ...rest, ...env }, encoding: 'utf8', timeout: 12000 });
}

/** Calls `fn` with a new temp dir named `prefix`-XXXX and removes the dir after. */
function withTemp(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { files, node, withTemp };
