// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap plan --profile quick|detailed: replicates, the profile flag on the printed commands, controls, scenarios, no
// default budget. The plan still runs nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeCapRepo, makeCapBench, entry, writeEntry, scratch } = require('./cap-helpers.js');
const { planCap } = require('../../cap/plan.js');
const { loadProfile } = require('../lib/profiles.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const DET = loadProfile('detailed');
const QUICK = loadProfile('quick');

function setup(tag = 'v1.2.0') {
  const root = scratch();
  const r = makeCapRepo(root, { tag });
  const bench = makeCapBench(root);
  writeEntry(bench, entry());
  const plan = (o = {}) => planCap({ repoRoot: r.repo, benchDir: bench, scratch: path.join(root, 'scr'), now: new Date('2026-01-02T03:04:05Z'), tmpRoot: path.join(root, 'tmp'), base: tag, ...o });
  return { root, repo: r.repo, bench, plan, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('detailed: 5 replicates by default, the profile flag on run, judge and report, and 3 replicates refused', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', profile: DET });
    assert.match(p.commands.run, /--replicates 5 /);
    assert.match(p.commands.run, /--profile detailed/);
    assert.match(p.commands.judge, /--profile detailed/);
    assert.match(p.commands.report, /--profile detailed/);
    assert.throws(() => s.plan({ mode: 'lift', cap: 'skill:alpha', profile: DET, reps: 3 }), /profile detailed needs at least 5 replicates per cell \(got 3\)/);
    assert.equal(s.plan({ mode: 'lift', cap: 'skill:alpha', profile: DET, reps: 7 }).commands.run.match(/--replicates (\d+)/)[1], '7');
  } finally { s.done(); }
});

test('detailed lift: the controls step, the scenario step and a warning when the plan has fewer than 8 tasks', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', profile: DET });
    assert.match(p.commands.controls, /cap controls --out \S+ --base v1\.2\.0 --reps 5/);
    assert.match(p.commands.scenarios, /cap scenarios --cap skill:alpha --n 8 --dry-run/);
    assert.match(p.text, /Known-answer controls/);
    assert.match(p.text, /Draft scenarios/);
    assert.ok(p.warnings.some((w) => /profile detailed wants at least 8 scenarios per skill study; this plan has 1 task/.test(w)), p.warnings.join('\n'));
    assert.match(p.text, /calibration-sample\.md/);
  } finally { s.done(); }
});

test('quick: 2 replicates by default, no controls, no scenario step, more than 3 refused', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', profile: QUICK });
    assert.match(p.commands.run, /--replicates 2 /);
    assert.match(p.commands.run, /--profile quick/);
    assert.equal(p.commands.controls, undefined);
    assert.equal(p.commands.scenarios, undefined);
    assert.throws(() => s.plan({ mode: 'lift', cap: 'skill:alpha', profile: QUICK, reps: 4 }), /profile quick allows 1 to 3 replicates \(got 4\)/);
  } finally { s.done(); }
});

test('with a profile there is no default budget: the run command has none and the text says nothing will stop it', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', profile: DET });
    assert.doesNotMatch(p.commands.run, /--budget-credits/);
    assert.equal(p.budget, null);
    assert.match(p.text, /No credit cap: spending is tracked in credit-ledger\.jsonl and nothing stops it/);
    assert.match(p.text, /A guard of \d+ credits would be --budget-credits \d+/);
    const g = s.plan({ mode: 'lift', cap: 'skill:alpha', profile: DET, budgetCredits: 90 });
    assert.match(g.commands.run, /--budget-credits 90/);
    assert.equal(g.budget, 90);
  } finally { s.done(); }
});

test('with a profile a missing observed figure is a note, not a refusal', () => {
  const s = setup('v0');
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', profile: DET });
    assert.equal(p.estimate, null);
    assert.match(p.text, /No estimate/);
    assert.throws(() => s.plan({ mode: 'lift', cap: 'skill:alpha' }), /no observed credits/);
  } finally { s.done(); }
});

test('without a profile the plan is what it was: 3 replicates, a budget, no profile flag, no controls', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha' });
    assert.match(p.commands.run, /--replicates 3 /);
    assert.match(p.commands.run, /--budget-credits \d+/);
    assert.doesNotMatch(p.text, /--profile/);
    assert.equal(p.commands.controls, undefined);
  } finally { s.done(); }
});

test('trigger mode takes the replicates from the profile and does not add the A/A profile to the run', () => {
  const s = setup();
  try {
    const e = entry({ tasks: { lift: ['rev-one'], trigger: ['rev-one'], headroom: {} } });
    writeEntry(s.bench, e);
    const p = s.plan({ mode: 'trigger', cap: 'skill:alpha', profile: DET });
    assert.match(p.commands.run, /--replicates 5 /);
    assert.doesNotMatch(p.commands.run, /--profile/);
    assert.equal(p.commands.controls, undefined);
  } finally { s.done(); }
});

test('cap plan --profile through the CLI prints the profile plan and runs nothing; a bad profile exits 2', () => {
  const s = setup();
  try {
    const home = path.join(s.root, 'h');
    fs.mkdirSync(home);
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: s.root };
    const args = ['cap', 'plan', '--mode', 'lift', '--cap', 'skill:alpha', '--base', 'v1.2.0', '--repo-root', s.repo, '--bench-dir', s.bench];
    const ok = spawnSync(process.execPath, [BENCH_JS, ...args, '--profile', 'detailed'], { encoding: 'utf8', env });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /--replicates 5/);
    const bad = spawnSync(process.execPath, [BENCH_JS, ...args, '--profile', 'huge'], { encoding: 'utf8', env });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /--profile takes quick or detailed/);
    const few = spawnSync(process.execPath, [BENCH_JS, ...args, '--profile', 'detailed', '--reps', '2'], { encoding: 'utf8', env });
    assert.equal(few.status, 2);
    assert.match(few.stderr, /at least 5 replicates/);
  } finally { s.done(); }
});
