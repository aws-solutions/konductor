// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap plan prints commands and an estimate and runs nothing. It refuses what the design refuses.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeCapRepo, makeCapBench, entry, writeEntry, scratch } = require('./cap-helpers.js');
const { write } = require('./helpers.js');
const { planCap } = require('../../cap/plan.js');
const { buildVariant } = require('../../cap/variant.js');
const { OBSERVED } = require('../lib/pr-plan.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

// A release-tagged repo (v1.2.0) so the observed credit table applies; the bench tasks sit in the lite tier.
function setup(entries = [entry()]) {
  const root = scratch();
  const r = makeCapRepo(root, { tag: 'v1.2.0' });
  const bench = makeCapBench(root);
  for (const e of entries) writeEntry(bench, e);
  const out = path.join(root, 'scr');
  const plan = (o = {}) => planCap({ repoRoot: r.repo, benchDir: bench, scratch: out, now: new Date('2026-01-02T03:04:05Z'), tmpRoot: path.join(root, 'tmp'), ...o });
  return { root, repo: r.repo, bench, out, plan, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const LITE = OBSERVED.suites.lite;

test('lift plan prints the variant, run, contrast, judge and report commands with the A/A sentinel arm', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha' });
    const t = p.text;
    assert.match(t, /cap variant --base v1\.2\.0 --drop skill:alpha --scratch /);
    assert.match(t, /--arms 'base=v1\.2\.0,base-b=v1\.2\.0,x-minus=dir:[^']+\/variants\/x-minus-alpha-[0-9a-f]{12}\/tree'/);
    assert.match(t, /--tasks rev-one /);
    assert.match(t, /--replicates 3 --parallel 1/);
    assert.match(t, /contrast --run \S+ --base base --head x-minus,base-b --by task/);
    assert.match(t, /judge --run \S+ --baseline base/);
    assert.match(t, /report --run \S+ --baseline base/);
    assert.deepEqual(Object.keys(p.commands).sort(), ['contrast', 'judge', 'report', 'run', 'variant']);
  } finally { s.done(); }
});

test('the plan estimates from the observed table: arms x tasks x replicates, with the cap at 1.5x', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', reps: 2 });
    const perTask = LITE.credits['v1.2.0'] / LITE.tasks;
    const total = 3 * perTask * 2;
    assert.ok(Math.abs(p.estimate.total - total) < 1e-9, String(p.estimate.total));
    assert.equal(p.budget, Math.ceil(total * 1.5));
    assert.match(p.text, new RegExp(`--budget-credits ${p.budget}`));
    assert.match(p.text, /Estimate/);
    const v = s.plan({ mode: 'lift', cap: 'skill:alpha', reps: 2, vanilla: true });
    assert.ok(Math.abs(v.estimate.total - (total + LITE.credits.vanilla / LITE.tasks * 2)) < 1e-9);
    assert.match(v.text, /--arms 'vanilla,base=v1\.2\.0/);
  } finally { s.done(); }
});

test('without observed figures the plan refuses to guess unless --budget-credits is given', () => {
  const root = scratch();
  try {
    const r = makeCapRepo(root, { tag: 'v0' });
    const bench = makeCapBench(root);
    writeEntry(bench, entry());
    const args = { mode: 'lift', cap: 'skill:alpha', base: 'v0', repoRoot: r.repo, benchDir: bench, scratch: path.join(root, 'scr') };
    assert.throws(() => planCap(args), /no observed credits for v0.*pass --budget-credits X/s);
    const p = planCap({ ...args, budgetCredits: 40 });
    assert.equal(p.estimate, null);
    assert.equal(p.budget, 40);
    assert.match(p.text, /No estimate/);
    assert.match(p.text, /--budget-credits 40/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('lift mode refuses a regex-only task unless --allow-regex', () => {
  const s = setup([entry({ tasks: { lift: ['rx-one'], trigger: [], headroom: {} } })]);
  try {
    assert.throws(() => s.plan({ mode: 'lift', cap: 'skill:alpha' }), /task rx-one is scored by checks alone.*--allow-regex/s);
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', allowRegex: true });
    assert.match(p.warnings.join('\n'), /rx-one.*regex-only/);
  } finally { s.done(); }
});

test('a hidden-test task and a rubric task are accepted', () => {
  const s = setup([entry({ tasks: { lift: ['hid-one', 'rev-one'], trigger: [], headroom: {} } })]);
  try { assert.doesNotThrow(() => s.plan({ mode: 'lift', cap: 'skill:alpha' })); } finally { s.done(); }
});

test('a linked task with no recorded headroom is a warning; a recorded one is not, and a ceiling one is flagged', () => {
  const s = setup();
  try {
    assert.match(s.plan({ mode: 'lift', cap: 'skill:alpha' }).warnings.join('\n'), /no recorded headroom for rev-one/);
  } finally { s.done(); }
  const withH = setup([entry({ tasks: { lift: ['rev-one'], trigger: [], headroom: { 'rev-one': { vanillaPass: 0.5, n: 3, source: 'run-1', date: '2026-01-01' } } } })]);
  try {
    assert.doesNotMatch(withH.plan({ mode: 'lift', cap: 'skill:alpha' }).warnings.join('\n'), /headroom/);
  } finally { withH.done(); }
  const ceil = setup([entry({ tasks: { lift: ['rev-one'], trigger: [], headroom: { 'rev-one': { vanillaPass: 0.95, n: 3, source: 'run-1', date: '2026-01-01' } } } })]);
  try {
    assert.match(ceil.plan({ mode: 'lift', cap: 'skill:alpha' }).warnings.join('\n'), /rev-one.*ceiling/);
  } finally { ceil.done(); }
});

test('--tasks overrides the registry links; no tasks at all is an error', () => {
  const s = setup([entry({ tasks: { lift: [], trigger: [], headroom: {} } })]);
  try {
    assert.throws(() => s.plan({ mode: 'lift', cap: 'skill:alpha' }), /no tasks for skill:alpha/);
    assert.match(s.plan({ mode: 'lift', cap: 'skill:alpha', tasks: ['rev-one'] }).text, /--tasks rev-one /);
    assert.throws(() => s.plan({ mode: 'lift', cap: 'skill:alpha', tasks: ['nope'] }), /unknown task "nope"/);
  } finally { s.done(); }
});

test('an unknown capability or mode is an error; an unregistered capability still plans with --tasks', () => {
  const s = setup();
  try {
    assert.throws(() => s.plan({ mode: 'lift', cap: 'skill:nope' }), /skill:nope does not exist at the base ref/);
    assert.throws(() => s.plan({ mode: 'weird', cap: 'skill:alpha' }), /--mode takes lift, trigger or improve/);
    assert.throws(() => s.plan({ mode: 'lift' }), /--cap is required/);
    assert.match(s.plan({ mode: 'lift', cap: 'skill:delta', tasks: ['rev-one'] }).text, /--drop skill:delta/);
  } finally { s.done(); }
});

test('a skill the acting agent cannot reach at startup is refused unless --force', () => {
  const s = setup([entry({ id: 'skill:beta', path: 'skills/beta/SKILL.md', expect: { 'kiro-cli': { tool: 'get_skill', actingAgents: ['k-dev'] } } })]);
  try {
    assert.throws(() => s.plan({ mode: 'lift', cap: 'skill:beta', actingAgents: ['konductor'] }), /capability not reachable at startup/);
    assert.doesNotThrow(() => s.plan({ mode: 'lift', cap: 'skill:beta' }), 'the registry names k-dev as the acting agent');
    const forced = s.plan({ mode: 'lift', cap: 'skill:beta', actingAgents: ['konductor'], force: true });
    assert.match(forced.warnings.join('\n'), /capability not reachable at startup/);
  } finally { s.done(); }
});

test('trigger mode runs the base arm only and reads loads with the skills command', () => {
  const s = setup([entry({ tasks: { lift: [], trigger: ['rev-one'], headroom: {} } })]);
  try {
    const p = s.plan({ mode: 'trigger', cap: 'skill:alpha' });
    assert.match(p.text, /--arms 'base=v1\.2\.0'/);
    assert.match(p.text, /bench\.js skills --run /);
    assert.doesNotMatch(p.text, /x-minus|cap variant/);
  } finally { s.done(); }
});

test('improve mode needs a candidate file and builds a replace variant', () => {
  const s = setup();
  try {
    assert.throws(() => s.plan({ mode: 'improve', cap: 'skill:alpha' }), /improve needs --candidate FILE/);
    const cand = path.join(s.root, 'cand.md');
    fs.writeFileSync(cand, '---\nname: alpha\ndescription: Use when X.\n---\n');
    const p = s.plan({ mode: 'improve', cap: 'skill:alpha', candidate: cand });
    assert.match(p.text, new RegExp(`--replace skill:alpha=${cand.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
    assert.match(p.text, /x-replace=dir:/);
  } finally { s.done(); }
});

test('the variant path in the plan is the path cap variant then builds, and planning wrote nothing', () => {
  const s = setup();
  try {
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha' });
    assert.equal(fs.existsSync(s.out), false, 'plan does not create the scratch directory');
    const v = buildVariant({ repo: s.repo, base: 'v1.2.0', drop: ['skill:alpha'], scratch: s.out });
    assert.ok(p.text.includes(v.armSpec), `${v.armSpec} not in plan`);
  } finally { s.done(); }
});

test('the plan carries --extra-tasks and --bench-dir through to every command that loads tasks', () => {
  const s = setup();
  try {
    const extra = path.join(s.root, 'extra');
    write(path.join(extra, 'x1.json'), JSON.stringify({ id: 'x1', class: 'review', target: null, prompt: 'Review.', fixture: 'fx', timeoutSec: 60, checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: [{ id: 'c', criterion: 'x', weight: 1 }], tiers: ['lite'] }));
    const p = s.plan({ mode: 'lift', cap: 'skill:alpha', tasks: ['x1'], extraTasks: [extra] });
    for (const k of ['run', 'contrast', 'judge', 'report']) assert.ok(p.commands[k].includes(`--extra-tasks ${extra}`), k);
  } finally { s.done(); }
});

test('cap plan via the CLI prints the plan, exits 0, and leaves the scratch HOME empty', () => {
  const s = setup();
  try {
    const home = path.join(s.root, 'h');
    fs.mkdirSync(home);
    const r = spawnSync(process.execPath, [BENCH_JS, 'cap', 'plan', '--mode', 'lift', '--cap', 'skill:alpha', '--repo-root', s.repo, '--bench-dir', s.bench, '--scratch', s.out], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, TMPDIR: os.tmpdir() } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Plan: lift of skill:alpha/);
    assert.deepEqual(fs.readdirSync(home), []);
    const bad = spawnSync(process.execPath, [BENCH_JS, 'cap', 'plan', '--mode', 'lift', '--cap', 'skill:alpha', '--base', 'nope-ref', '--repo-root', s.repo, '--bench-dir', s.bench, '--scratch', s.out], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home } });
    assert.equal(bad.status, 2);
  } finally { s.done(); }
});
