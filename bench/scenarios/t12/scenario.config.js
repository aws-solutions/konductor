// SPDX-License-Identifier: Apache-2.0
'use strict';

// T12's (orchestration core: spec workflow, full SDLC, delegation hand-offs, parallel plans, worker branches) batch
// config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t12/scenario.config.js [id ...] [--record]
// Besides the reference, stub, lazy and alternative answers, a task may keep a hand-written shallow fake in
// answers/<id>/shallow/ (a short answer that uses the right words without doing the work); the dry run scores it with
// the shallow gate (40).
// An answer dir holding PLAY.json is a scripted agent doing git work in the workspace (the worker tasks, see play());
// one holding APPLY.sh runs that script (bench/scenarios/lib/git-answers.js); any other is a plain file overlay.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { defaultModes } = require('../lib/config.js');
const { listTree } = require('../lib/workspace.js');
const { GIT_ENV, overlayOf } = require('../lib/git-answers.js');

/**
 * The scripted agent of PLAY.json in `dir`:
 *   workers  [{ branch, steps: [dirs of files at repository paths, one commit each], message? }]: each worker gets
 *            its own worktree on its own branch made from main, before any merge (the workers run side by side)
 *   merge    the branches to merge into main, in order, each with its own merge commit; `resolve` maps a branch to a
 *            dir of files that settle a merge conflict
 *   direct   dirs laid straight onto main and committed together (one agent doing all the work itself)
 *   commits  [{ dir, message }]: dirs laid onto main and committed one at a time, in order
 *   cleanup  remove the worktrees and delete the merged branches
 */
function play(dir) {
  const p = JSON.parse(fs.readFileSync(path.join(dir, 'PLAY.json'), 'utf8'));
  return (ws) => {
    const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: { ...process.env, ...GIT_ENV }, stdio: 'pipe' });
    const lay = (from, to) => fs.cpSync(path.join(dir, from), to, { recursive: true, force: true });
    const trees = [];
    for (const w of p.workers || []) {
      const wt = path.join(ws, '.worktrees', w.branch.replace(/\//g, '-'));
      git(ws, 'worktree', 'add', '-q', '-b', w.branch, wt, 'main');
      trees.push([wt, w.branch]);
      for (const step of w.steps) {
        lay(step, wt);
        git(wt, 'add', '-A');
        git(wt, 'commit', '-q', '-m', w.message || `${w.branch}: ${step}`);
      }
    }
    for (const b of p.merge || []) {
      try {
        git(ws, 'merge', '--no-ff', '-q', '-m', `Merge ${b}`, b);
      } catch (e) {
        if (!p.resolve || !p.resolve[b]) throw e;
        lay(p.resolve[b], ws);
        // only the resolved files: `git add -A` would take the workers' worktrees in as embedded repositories
        git(ws, 'add', '--', ...listTree(path.join(dir, p.resolve[b])));
        git(ws, 'commit', '-q', '--no-edit');
      }
    }
    if (p.direct) {
      for (const d of p.direct) lay(d, ws);
      git(ws, 'add', '-A');
      git(ws, 'commit', '-q', '-m', p.message || 'Fix the issues');
    }
    for (const c of p.commits || []) {
      lay(c.dir, ws);
      git(ws, 'add', '-A');
      git(ws, 'commit', '-q', '-m', c.message);
    }
    if (p.cleanup) {
      for (const [wt, b] of trees) {
        git(ws, 'worktree', 'remove', wt);
        git(ws, 'branch', '-q', '-d', b);
      }
      fs.rmSync(path.join(ws, '.worktrees'), { recursive: true, force: true });
    }
  };
}

const answer = (dir) => (typeof dir === 'string' && fs.existsSync(path.join(dir, 'PLAY.json')) ? play(dir) : overlayOf(dir));

module.exports = {
  dir: __dirname,
  python: false,
  env: GIT_ENV,
  // Task lists are ordered (the prompts say "in the order they should be done"), so the alternative answer keeps their order.
  answers: { orderedKeys: /path|order|chain|sequence|milestones|steps|timeline|tasks|waves|merge/i },
  modes: (task, cfg) => defaultModes(task, cfg).map((m) => ({ ...m, overlay: answer(m.overlay) })),
  variants: (task, cfg) => {
    const d = cfg.answerDir(task.id, 'shallow');
    return fs.existsSync(d) ? [{ name: 'shallow', overlay: d }] : [];
  },
  play,
};
