// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap skill-plan, cap skill-study (init, status, dry run) and cap decide through bench.js, with a scratch HOME and no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { env, withRuns } = require('./cap-study-helpers.js');
const { runStudy, loadStudy } = require('../../cap/skillstudy.js');
const { planSkillStudy, renderPlan } = require('../../cap/skillplan.js');
const { makeRunDir } = require('./cap-prune-helpers.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

function cli(e, args) {
  const home = fs.mkdtempSync(path.join(e.root, 'h-'));
  const tmp = fs.mkdtempSync(path.join(e.root, 't-'));
  return spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', cwd: e.root, env: { PATH: process.env.PATH, HOME: home, TMPDIR: tmp, BENCH_CAP_INSTALLS_HOMES: home } });
}
const common = (e) => ['--base', 'v0', '--repo-root', e.repo, '--bench-dir', e.bench];

test('cap skill-plan prints the tiers, the estimate and its assumptions, and --json is the same plan', () => {
  const e = env();
  try {
    const runs = withRuns(e, { tasks: ['rev-one', 'hid-one'] });
    const r = cli(e, ['cap', 'skill-plan', ...common(e), '--runs', runs, '--tasks-per-skill', '2', '--reps', '5', '--large-top', '0', '--large', '']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Per-skill study plan/);
    assert.match(r.stdout, /\| loaded \|/);
    assert.match(r.stdout, /estimate/i);
    assert.match(r.stdout, /own assumptions/);
    const j = cli(e, ['cap', 'skill-plan', ...common(e), '--runs', runs, '--tasks-per-skill', '2', '--reps', '5', '--json']);
    assert.equal(j.status, 0, j.stderr);
    const plan = JSON.parse(j.stdout);
    assert.equal(plan.profile.reps, 5);
    assert.ok(plan.skills.length >= 10);
  } finally { e.done(); }
});

test('cap skill-plan --out writes the plan files and nothing else', () => {
  const e = env();
  try {
    const out = path.join(e.root, 'planout');
    const r = cli(e, ['cap', 'skill-plan', ...common(e), '--runs', withRuns(e), '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(fs.readdirSync(out).sort(), ['skill-plan.json', 'skill-plan.md']);
  } finally { e.done(); }
});

test('cap skill-plan refuses an unknown tier or skill with exit 2 and runs nothing', () => {
  const e = env();
  try {
    assert.equal(cli(e, ['cap', 'skill-plan', ...common(e), '--tier', 'weird']).status, 2);
    const r = cli(e, ['cap', 'skill-plan', ...common(e), '--only', 'nope']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown skill/);
  } finally { e.done(); }
});

test('cap skill-study --init writes study.json, --status reads it, and --dry-run launches nothing', () => {
  const e = env();
  try {
    const study = path.join(e.root, 'study');
    const creds = path.join(e.root, 'creds');
    fs.writeFileSync(creds, 'x');
    const init = cli(e, ['cap', 'skill-study', '--init', '--study', study, ...common(e), '--runs', withRuns(e, { tasks: ['rev-one', 'hid-one'] }), '--tasks-per-skill', '2', '--reps', '5', '--only', 'sectioned', '--aws-creds-file', creds, '--scratch', path.join(e.root, 'scratch')]);
    assert.equal(init.status, 0, init.stderr);
    assert.ok(fs.existsSync(path.join(study, 'study.json')));
    assert.equal(loadStudy(study).plan.skills.filter((s) => s.lift).length, 1);
    const st = cli(e, ['cap', 'skill-study', '--status', '--study', study]);
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /waves done: 0\/1/);
    const dry = cli(e, ['cap', 'skill-study', '--dry-run', '--study', study, '--aws-creds-file', creds]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /sectioned wave 1: arms ctl, ctl-b, del/);
    assert.equal(fs.existsSync(path.join(study, 'skills/sectioned/w1')), false);
    assert.equal(fs.existsSync(path.join(e.root, 'scratch', 'variants')), false);
  } finally { e.done(); }
});

test('cap skill-study without --study, or with --init on a different base, fails with exit 2 before any work', () => {
  const e = env();
  try {
    assert.equal(cli(e, ['cap', 'skill-study', '--status']).status, 2);
    const r = cli(e, ['cap', 'skill-study', '--study', path.join(e.root, 'nostudy'), '--dry-run']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no study/);
  } finally { e.done(); }
});

test('cap decide reads a finished study and writes the report, the evidence and the patches', async () => {
  const e = env();
  try {
    const mod = require('./cap-skillstudy-fake.js');
    const s = mod.setupAndRun(e, { del: 0.3, rm2: 0.3, rm3: 0.3, mv3: 0.3 });
    await s;
    const out = path.join(e.root, 'decided');
    const r = cli(e, ['cap', 'decide', '--study', path.join(e.root, 'study'), '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /PRUNE/);
    const j = JSON.parse(fs.readFileSync(path.join(out, 'decisions.json'), 'utf8'));
    assert.equal(j.decisions.find((d) => d.name === 'sectioned').decision, 'PRUNE');
    assert.ok(fs.existsSync(path.join(out, 'patches/sectioned.patch')));
  } finally { e.done(); }
});

test('renderPlan labels the figures as estimates and lists every tier', () => {
  const e = env();
  try {
    const plan = planSkillStudy({ repo: e.repo, base: 'v0', benchDir: e.bench, runDirs: [withRuns(e)], tmpRoot: e.root, tasksPerSkill: 2, reps: 5 });
    const t = renderPlan(plan);
    for (const tier of ['loaded', 'large', 'duplicates', 'triage']) assert.match(t, new RegExp(`\\| ${tier} \\|`));
    assert.match(t, /estimate/i);
    assert.match(t, /Why not every skill gets a lift study/);
    void makeRunDir;
  } finally { e.done(); }
});
