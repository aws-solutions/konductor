// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap controls through the CLI, and cap trigger --profile. No model, no credits: a fake run directory and a dry run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeCapRepo, makeCapBench, entry, writeEntry, scratch } = require('./cap-helpers.js');
const { makeRun, makeBench, write } = require('./helpers.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

function setup() {
  const root = scratch();
  const r = makeCapRepo(root, { tag: 'v1.2.0' });
  const bench = makeCapBench(root);
  writeEntry(bench, entry());
  const home = path.join(root, 'h');
  fs.mkdirSync(home);
  const env = { PATH: process.env.PATH, HOME: home, TMPDIR: root };
  const cli = (...a) => spawnSync(process.execPath, [BENCH_JS, 'cap', ...a], { encoding: 'utf8', env });
  return { root, repo: r.repo, bench, cli, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('cap controls --out writes the control skills and tasks outside the repository and prints the three steps', () => {
  const s = setup();
  try {
    const out = path.join(s.root, 'ctl');
    const r = s.cli('controls', '--out', out, '--base', 'v1.2.0', '--repo-root', s.repo, '--bench-dir', s.bench);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(out, 'controls', 'skills', 'release-codename', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(out, 'controls', 'tasks', 'control-prune.json')));
    assert.match(r.stdout, /1\. Build the two variants \(free\)/);
    assert.match(r.stdout, /cap variant --base v1\.2\.0 --add skill:release-codename=/);
    assert.match(r.stdout, /--replicates 5 --parallel 1 --extra-tasks/);
    assert.match(r.stdout, /40 runs: 2 tasks x 4 arms x 5 replicates/);
    assert.match(r.stdout, /cap controls --check .* --base-arm base --aa base-b --keep ctl-keep --prune ctl-prune/);
    const inRepo = s.cli('controls', '--out', path.join(s.repo, 'x'), '--repo-root', s.repo, '--bench-dir', s.bench);
    assert.equal(inRepo.status, 2);
    assert.match(inRepo.stderr, /inside the repository/);
    assert.equal(s.cli('controls', '--repo-root', s.repo, '--bench-dir', s.bench).status, 2);
  } finally { s.done(); }
});

function controlsRun(s, { keepPasses = true } = {}) {
  const out = path.join(s.root, 'ctl');
  s.cli('controls', '--out', out, '--base', 'v1.2.0', '--repo-root', s.repo, '--bench-dir', s.bench);
  const bench = makeBench(path.join(s.root, 'fxbench'));
  const spec = (arm, task, rep, passed) => ({ arm, task, rep, checks: [{ type: 'contains', path: 'x', pattern: 'x', passed }] });
  const specs = [];
  for (let rep = 1; rep <= 4; rep++) {
    specs.push(spec('base', 'control-keep', rep, false), spec('base-b', 'control-keep', rep, false), spec('ctl-keep', 'control-keep', rep, keepPasses));
    specs.push(spec('base', 'control-prune', rep, true), spec('base-b', 'control-prune', rep, true), spec('ctl-prune', 'control-prune', rep, true));
  }
  const runDir = makeRun(path.join(s.root, 'run'), bench, specs);
  return { out, runDir, tasksDir: path.join(out, 'controls', 'tasks') };
}

test('cap controls --check exits 0 and writes controls-check.json when the planted lift is found and the decoy is quiet', () => {
  const s = setup();
  try {
    const c = controlsRun(s);
    const r = s.cli('controls', '--check', c.runDir, '--base-arm', 'base', '--aa', 'base-b', '--keep', 'ctl-keep', '--prune', 'ctl-prune', '--extra-tasks', c.tasksDir, '--bench-dir', s.bench);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /keep control\s+PASS/);
    assert.match(r.stdout, /prune control\s+PASS/);
    assert.match(r.stdout, /can be trusted/);
    const j = JSON.parse(fs.readFileSync(path.join(c.runDir, 'controls-check.json'), 'utf8'));
    assert.equal(j.trusted, true);
    assert.deepEqual(j.arms, { base: 'base', keep: 'ctl-keep', prune: 'ctl-prune', aa: 'base-b' });
  } finally { s.done(); }
});

test('cap controls --check exits 1 when the planted lift is missed', () => {
  const s = setup();
  try {
    const c = controlsRun(s, { keepPasses: false });
    const r = s.cli('controls', '--check', c.runDir, '--base-arm', 'base', '--keep', 'ctl-keep', '--prune', 'ctl-prune', '--extra-tasks', c.tasksDir, '--bench-dir', s.bench);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /keep control\s+FAIL/);
    assert.match(r.stdout, /Do not trust/);
  } finally { s.done(); }
});

test('cap controls --check names a missing arm, a missing flag and a missing extra-tasks directory', () => {
  const s = setup();
  try {
    const c = controlsRun(s);
    const base = ['controls', '--check', c.runDir, '--bench-dir', s.bench];
    assert.match(s.cli(...base, '--base-arm', 'base', '--keep', 'ctl-keep', '--prune', 'nope', '--extra-tasks', c.tasksDir).stderr, /arm "nope" has no runs/);
    assert.match(s.cli(...base, '--base-arm', 'base', '--prune', 'ctl-prune', '--extra-tasks', c.tasksDir).stderr, /--keep is required with --check/);
    assert.match(s.cli(...base, '--base-arm', 'base', '--keep', 'ctl-keep', '--prune', 'ctl-prune').stderr, /task control-keep is not loaded: pass --extra-tasks/);
  } finally { s.done(); }
});

test('cap trigger live --dry-run: --profile sets the replicates and drops the budget requirement; without it the budget is still required', () => {
  const s = setup();
  try {
    const draft = path.join(s.root, 'draft.json');
    write(draft, JSON.stringify({ capId: 'skill:alpha', queries: [{ id: 'd01', text: 'Please look over this service for input handling problems', expect: 'load', rationale: 'r' }] }));
    const args = ['trigger', '--cap', 'skill:alpha', '--mode', 'live', '--queries', draft, '--dry-run', '--out', path.join(s.root, 'o'), '--repo-root', s.repo, '--bench-dir', s.bench, '--base', 'v1.2.0'];
    const bare = s.cli(...args);
    assert.equal(bare.status, 2);
    assert.match(bare.stderr, /--budget-credits is required for live mode/);
    const det = s.cli(...args, '--profile', 'detailed');
    assert.equal(det.status, 0, det.stderr);
    assert.match(det.stdout, /--replicates 5/);
    const quick = s.cli(...args, '--profile', 'quick');
    assert.match(quick.stdout, /--replicates 2/);
    const tooFew = s.cli(...args, '--profile', 'detailed', '--reps', '3');
    assert.equal(tooFew.status, 2);
    assert.match(tooFew.stderr, /at least 5 replicates/);
  } finally { s.done(); }
});
