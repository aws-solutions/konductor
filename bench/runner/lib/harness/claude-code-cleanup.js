// SPDX-License-Identifier: Apache-2.0
'use strict';

// Removes what Claude Code wrote under the temp dirs for one run (<tmp>/claude-<uid>/<cwd slug>). Split out of
// claude-code.js (DEBT D-192).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertPlainPath } = require('../safe-copy.js');

const slugOf = (cwd) => {
  let real = cwd;
  try { real = fs.realpathSync(cwd); } catch { /* the directory is already gone */ }
  return real.replace(/[^A-Za-z0-9]/g, '-');
};

// The run's own TMPDIR is agent-writable, so a link there must not steer the delete at a host folder. The shared temp
// dir may itself sit behind a link (macOS /var), so only the parts below it are checked.
function isPlainTaskDir(base, runTmpdir, rel) {
  try {
    if (base === runTmpdir && fs.lstatSync(base).isSymbolicLink()) return false;
    assertPlainPath(base, rel, { last: 'dir' });
    return true;
  } catch { return false; }
}

/**
 * Claude Code writes task output under <tmp>/claude-<uid>/<cwd slug>/..., outside HOME. The run's temp directory is given to
 * the process as TMPDIR and CLAUDE_CODE_TMPDIR, and this removes what it made there or in the default temp directory. The cwd slug is unique to the run, so
 * parallel runs never touch each other's files.
 */
function cleanupRun({ cwd, tmpdir, tmpBases = [os.tmpdir()], uid = process.getuid ? process.getuid() : null }) {
  if (uid === null) return [];
  const slug = slugOf(cwd);
  const removed = [];
  for (const base of new Set([tmpdir, ...tmpBases].filter(Boolean))) {
    const root = path.join(base, `claude-${uid}`);
    const dir = path.join(root, slug);
    if (!isPlainTaskDir(base, tmpdir, path.join(`claude-${uid}`, slug))) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
    try { if (!fs.readdirSync(root).length) fs.rmdirSync(root); } catch { /* another run uses it */ }
  }
  return removed;
}

/** Where cleanupRun found claude's task directory: in the run's own TMPDIR (claude honors it) or in the default temp dir. */
function describeCleanup(removed, tmpdir) {
  const inRun = removed.filter((d) => d.startsWith(`${tmpdir}${path.sep}`)).length;
  return { removed: removed.length, inRunTmpdir: inRun, inDefaultTmp: removed.length - inRun };
}

module.exports = { slugOf, cleanupRun, describeCleanup };
