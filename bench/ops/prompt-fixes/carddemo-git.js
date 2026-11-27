#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Batch C's task copy: cx-carddemo-batchday with a git-initialised fixture, so a team plan can use worktrees. Free.
//   node carddemo-git.js --bench B --out DIR
// Copies bench/complex's task file, fixture, hidden tests, solution, partials and stub for the task into DIR/tasks (the
// layout an --extra-tasks directory has), and adds DIR/tasks/fixtures/<fixture>/dotgit: one commit on main of the fixture
// without its answer key, with a fixed identity and date, so the commit id is the same on every build. Writes
// DIR/suites/complex.json (this one task, extraTasks DIR/tasks) for bench --suites-dir, and DIR/manifest.json: the commit id
// and a sha256 of each copied tree. Refuses when a copied tree differs from its source (the signed hidden tests and the
// goldens must stay byte for byte). Prints the manifest.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ID = 'cx-carddemo-batchday';
const ANSWER_KEY = '.bench-answer-key.md';
const ENV = {
  ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-03-01T09:00:00Z', GIT_COMMITTER_DATE: '2026-03-01T09:00:00Z',
};

/** sha256 over a tree's relative paths and bytes, sorted; `skip(rel)` leaves a path out. */
function treeHash(dir, skip = () => false) {
  const h = crypto.createHash('sha256');
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skip(r)) continue;
      if (e.isDirectory()) walk(r);
      else h.update(`${r}\0`).update(fs.readFileSync(path.join(dir, r))).update('\0');
    }
  };
  walk('');
  return h.digest('hex');
}

function build({ bench, out }) {
  const src = path.join(bench, 'complex');
  const task = JSON.parse(fs.readFileSync(path.join(src, `${ID}.json`), 'utf8'));
  const O = path.resolve(out);
  if (fs.existsSync(O) && fs.readdirSync(O).length) throw new Error(`${O} is not empty; build into a new directory`);
  const parts = { fixtures: task.fixture, hidden: task.hidden, solutions: ID, partials: ID, stubs: ID };
  const hashes = {};
  const T = path.join(O, 'tasks');
  fs.mkdirSync(T, { recursive: true });
  fs.copyFileSync(path.join(src, `${ID}.json`), path.join(T, `${ID}.json`));
  for (const [part, name] of Object.entries(parts)) {
    const from = path.join(src, part, name);
    if (!fs.existsSync(from)) continue;
    const to = path.join(T, part, name);
    fs.cpSync(from, to, { recursive: true });
    hashes[part] = treeHash(from);
    if (treeHash(to) !== hashes[part]) throw new Error(`${part}/${name}: the copy differs from its source`);
  }
  const fixture = path.join(T, 'fixtures', task.fixture);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-git-'));
  let commit;
  try {
    fs.cpSync(fixture, work, { recursive: true, filter: (p) => path.basename(p) !== ANSWER_KEY });
    const git = (...a) => execFileSync('git', a, { cwd: work, env: ENV, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main', '--template=');
    git('add', '-A');
    git('commit', '-q', '-m', 'Initial import');
    commit = git('rev-parse', 'HEAD');
    // One pack file and packed refs keep the fixture under the validator's file limit; the runner's copy puts back the
    // empty refs/ and objects/ dirs git needs (sandbox.js copyFixture).
    git('gc', '-q', '--prune=now');
    for (const f of ['logs', 'COMMIT_EDITMSG', 'info']) fs.rmSync(path.join(work, '.git', f), { recursive: true, force: true });
    fs.cpSync(path.join(work, '.git'), path.join(fixture, 'dotgit'), { recursive: true });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (treeHash(fixture, (r) => r === 'dotgit' || r.startsWith('dotgit/')) !== hashes.fixtures) throw new Error('the fixture copy changed beyond its dotgit');
  fs.mkdirSync(path.join(O, 'suites'), { recursive: true });
  fs.writeFileSync(path.join(O, 'suites', 'complex.json'), `${JSON.stringify({ extraTasks: [T], tasks: [ID], arms: ['vanilla'], replicates: 1, parallel: 1, judges: [] }, null, 2)}\n`);
  const manifest = { task: ID, tasksDir: T, suitesDir: path.join(O, 'suites'), commit, source: src, hashes, answerKeySha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(src, 'fixtures', task.fixture, ANSWER_KEY))).digest('hex') };
  fs.writeFileSync(path.join(O, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function main(argv) {
  const opt = {};
  for (let i = 0; i < argv.length; i += 2) {
    if ((argv[i] === '--bench' || argv[i] === '--out') && argv[i + 1]) opt[argv[i].slice(2)] = argv[i + 1];
    else { console.error('usage: carddemo-git.js --bench B --out DIR'); return 64; }
  }
  if (!opt.bench || !opt.out) { console.error('usage: carddemo-git.js --bench B --out DIR'); return 64; }
  try { console.log(JSON.stringify(build(opt), null, 2)); } catch (e) { console.error(`STOP: ${e.message}`); return 1; }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { build, treeHash, ID };
