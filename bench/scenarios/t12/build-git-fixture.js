#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Gives a T12 fixture its own git repository: the fixture's files become one commit on main, with a fixed identity
// and date, so the commit id is the same on every build. The repository is kept as fixtures/<id>/dotgit (the runner
// renames it to .git when it copies the fixture; git cannot store a .git directory). Prints the commit id, which the
// task's hidden work.json names as `base`. No network, no model.
//   node bench/scenarios/t12/build-git-fixture.js <id>

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ENV = {
  ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-03-01T09:00:00Z', GIT_COMMITTER_DATE: '2026-03-01T09:00:00Z',
};

function build(id) {
  const fixture = path.join(__dirname, 'fixtures', id);
  const dotgit = path.join(fixture, 'dotgit');
  fs.rmSync(dotgit, { recursive: true, force: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 't12-fixture-'));
  try {
    // The answer key is judge-only: the runner leaves it out of the workspace, so it must not be in the history either.
    fs.cpSync(fixture, work, { recursive: true, filter: (p) => path.basename(p) !== '.bench-answer-key.md' && p !== dotgit });
    const git = (...a) => execFileSync('git', a, { cwd: work, env: ENV, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main', '--template=');
    git('add', '-A');
    git('commit', '-q', '-m', 'Initial import');
    fs.cpSync(path.join(work, '.git'), dotgit, { recursive: true });
    return execFileSync('git', ['--git-dir', dotgit, 'rev-parse', 'HEAD'], { env: ENV, encoding: 'utf8' }).trim();
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) console.log(build(process.argv[2]));

module.exports = { build };
