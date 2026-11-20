// SPDX-License-Identifier: Apache-2.0
'use strict';

// T11's scored answers, for the shared dry run and for the author's own check (selfcheck.js). An answer is a directory
// overlay, as everywhere in the pack, or, for a git task, a directory holding APPLY.sh: the script runs in the workspace
// (with the fixture's own repository in .git) and does the git work itself (merge, commit), reading its files from
// $OVERLAY. Its commits use the fixed identity and date below, so repeats give the same history.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'Bench Reference', GIT_AUTHOR_EMAIL: 'reference@example.invalid',
  GIT_COMMITTER_NAME: 'Bench Reference', GIT_COMMITTER_EMAIL: 'reference@example.invalid',
  GIT_AUTHOR_DATE: '2026-03-02T12:00:00Z', GIT_COMMITTER_DATE: '2026-03-02T12:00:00Z',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
};

/** The overlay of answer dir `dir`: null when it does not exist, a function when it holds APPLY.sh, else the dir. */
function overlayOf(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const script = path.join(dir, 'APPLY.sh');
  if (!fs.existsSync(script)) return dir;
  return (ws) => {
    const r = spawnSync('sh', [script], { cwd: ws, env: { ...process.env, ...GIT_ENV, OVERLAY: dir }, encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) throw new Error(`APPLY.sh of ${dir} failed (${r.status}): ${(r.stderr || '').slice(-400)}`);
  };
}

/** reference and stub (repeated), then lazy, alt and shallow when present. `dirs` gives the answer dirs of one task. */
function modesOf(dirs) {
  const modes = [
    { name: 'reference', overlay: overlayOf(dirs.solution), repeat: true },
    { name: 'stub', overlay: null, repeat: true },
  ];
  // shallow: an answer that misses the point (for a memory task, one that follows the stale notes); gated at 40 or less.
  for (const kind of ['lazy', 'alt', 'shallow']) {
    const o = overlayOf(dirs[kind]);
    if (o) modes.push({ name: kind, overlay: o });
  }
  return modes;
}

module.exports = { GIT_ENV, overlayOf, modesOf };
