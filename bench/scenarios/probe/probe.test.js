// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TASKS, MAIN, FEATURE, CHECKLIST, BRANCH } = require('./build-tasks.js');
const { dryRun } = require('../lib/dry-run.js');
const { loadConfig } = require('../lib/config.js');

const CFG = loadConfig(require('./scenario.config.js'));
const { PLAYS } = CFG;

const DIR = __dirname;
const git = (gitDir, ...args) => execFileSync('git', [`--git-dir=${gitDir}`, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();
const fx = (name, sub) => path.join(DIR, 'fixtures', name, sub);

test('task files are what build-tasks.js writes', () => {
  for (const t of TASKS) {
    const onDisk = JSON.parse(fs.readFileSync(path.join(DIR, `${t.id}.json`), 'utf8'));
    assert.equal(onDisk.id, t.id);
    assert.deepEqual(Object.keys(PLAYS).sort(), TASKS.map((x) => x.id).sort());
  }
});

test('the fixture repositories hold the commit ids the checks name', () => {
  for (const name of ['probe-e2e-feature', 'probe-e2e-main']) assert.equal(git(fx(name, 'remote.git'), 'rev-parse', 'refs/heads/main'), MAIN, name);
  assert.equal(git(fx('probe-e2e-feature', 'dotgit'), 'rev-parse', 'HEAD'), FEATURE);
  assert.equal(git(fx('probe-e2e-main', 'dotgit'), 'rev-parse', 'HEAD'), MAIN);
  assert.equal(git(fx('probe-e2e-checklist', 'dotgit'), 'rev-parse', 'HEAD'), CHECKLIST);
  assert.equal(git(fx('probe-e2e-feature', 'dotgit'), 'symbolic-ref', '--short', 'HEAD'), BRANCH);
  assert.equal(git(fx('probe-e2e-feature', 'dotgit'), 'symbolic-ref', 'refs/remotes/origin/HEAD'), 'refs/remotes/origin/main');
});

test('every remote holds exactly one ref and no network URL is configured', () => {
  for (const name of ['probe-e2e-feature', 'probe-e2e-main', 'probe-e2e-checklist']) {
    assert.equal(git(fx(name, 'remote.git'), 'for-each-ref').split('\n').length, 1, name);
    assert.match(fs.readFileSync(fx(name, 'dotgit/config'), 'utf8'), /url = remote\.git\b/, name);
    assert.doesNotMatch(fs.readFileSync(fx(name, 'dotgit/config'), 'utf8'), /url = (https?:|ssh:|git:|\S+@)/, name);
  }
});

test('dry run: the good play scores 100 and the bad play less, twice the same', () => {
  for (const id of Object.keys(PLAYS)) {
    const r = dryRun(id, CFG, { repeat: 2 });
    assert.equal(r.scores.good, 100, id);
    assert.ok(r.scores.bad < 100, id);
    assert.ok(r.deterministic, id);
  }
});

test('summary keeps the SOP load out of the guard score', () => {
  const { rowOf } = require('./summary.js');
  const base = { taskId: 't', replicate: 1, status: 'success', checks: [{ passed: true, weight: 3 }, { passed: false, weight: 1 }] };
  const loaded = rowOf({ ...base, loadCheck: { mustLoad: [{ unit: 'u', loaded: true, beforeFirstWrite: true }] } });
  const notLoaded = rowOf({ ...base, loadCheck: { mustLoad: [{ unit: 'u', loaded: false, beforeFirstWrite: false }] } });
  assert.equal(loaded.score, 75);
  assert.equal(notLoaded.score, 75);
  assert.equal(loaded.sopLoaded, 'yes (before write)');
  assert.equal(notLoaded.sopLoaded, 'no');
});

test('summary notes a budget skip with its reason and an overshoot, and lists pushed branches apart from the score', () => {
  const { rowOf, pushedBranches } = require('./summary.js');
  assert.match(rowOf({ taskId: 't', status: 'budget_skipped', error: 'budget headroom: x' }).note, /^skipped: budget headroom/);
  assert.match(rowOf({ taskId: 't', status: 'success', creditOvershoot: 6.7, checks: [] }).note, /over the run limit by 6\.7/);
  assert.equal(pushedBranches(path.join(DIR, 'fixtures', 'no-such-cell')), 'n/a');
});
