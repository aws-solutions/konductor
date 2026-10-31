// SPDX-License-Identifier: Apache-2.0
'use strict';

// Known-answer controls for skill studies: a planted skill that must show a lift and a decoy that must not.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp } = require('./helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const C = require('../../cap/controls.js');

const BENCH = path.join(__dirname, '..', '..');
const DASH = /[\u2013\u2014]/;

function repoWithTag(root, tag = 'v1.2.0') {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', env });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'f.txt'), 'x\n');
  git('add', 'f.txt');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init');
  git('tag', tag);
  return repo;
}

test('the keep control holds a fact nobody can guess, the prune control holds something unrelated to its task', () => {
  const c = C.buildControls();
  const keep = c.skills.find((s) => s.role === 'keep');
  const prune = c.skills.find((s) => s.role === 'prune');
  assert.match(keep.text, /^---\nname: release-codename\ndescription: /);
  assert.match(prune.text, /^---\nname: starter-feeding\ndescription: /);
  assert.ok(keep.text.includes(C.CODENAME));
  const keepTask = c.tasks.find((t) => t.control === 'positive');
  const pruneTask = c.tasks.find((t) => t.control === 'negative');
  assert.ok(!keepTask.prompt.includes(C.CODENAME), 'the answer is not in the prompt');
  assert.ok(keepTask.checks.some((k) => k.type === 'contains' && k.pattern === C.CODENAME));
  assert.ok(!c.fixtures.some((f) => Object.values(f.files).some((t) => t.includes(C.CODENAME))), 'the answer is not in a fixture');
  assert.ok(!/sourdough|starter/i.test(pruneTask.prompt), 'the prune task has nothing to do with the decoy');
  for (const t of c.tasks) assert.ok(!/skill|SOP|konductor|\bk-/i.test(t.prompt), `${t.id} prompt names no capability`);
});

test('control text uses no em or en dashes and the task ids and skill names are neutral', () => {
  const c = C.buildControls();
  for (const s of c.skills) assert.ok(!DASH.test(s.text), s.name);
  for (const t of c.tasks) assert.ok(!DASH.test(JSON.stringify(t)), t.id);
  for (const n of [...c.skills.map((s) => s.name), ...c.tasks.map((t) => t.id)]) assert.ok(!/bench|control|test/i.test(n.replace(/^control-(keep|prune)$/, '')), `${n} should not look like a benchmark artefact to the agent`);
});

test('writeControls writes skills, tasks and fixtures that the task loader accepts as an extra tasks directory', () => {
  const out = tmp();
  try {
    const w = C.writeControls({ outDir: out });
    assert.ok(fs.existsSync(path.join(w.skillsDir, 'release-codename', 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(w.skillsDir, 'starter-feeding', 'SKILL.md')));
    const tasks = loadTasks(BENCH, { extraDirs: [w.tasksDir] });
    assert.equal(tasks.get('control-keep').control, 'positive');
    assert.equal(tasks.get('control-prune').control, 'negative');
    assert.equal(tasks.get('control-keep').target, 'skill:release-codename');
    assert.ok(fs.existsSync(tasks.get('control-keep').fixtureDir));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('controlPlan gives the exact arm specs and the four steps, and counts the runs', () => {
  const root = tmp();
  try {
    const repo = repoWithTag(root);
    const out = path.join(root, 'out');
    const w = C.writeControls({ outDir: out });
    const p = C.controlPlan({ repo, base: 'v1.2.0', writes: w, scratch: path.join(root, 'scratch'), replicates: 5, tmpRoot: root });
    assert.equal(p.arms.length, 4);
    assert.match(p.arms.join(' '), /base=v1\.2\.0/);
    assert.match(p.arms.join(' '), /base-b=v1\.2\.0/);
    assert.match(p.arms.find((a) => a.startsWith('ctl-keep=')), /^ctl-keep=dir:.*variants\/x-plus-release-codename-[0-9a-f]{12}\/tree$/);
    assert.match(p.arms.find((a) => a.startsWith('ctl-prune=')), /^ctl-prune=dir:.*variants\/x-plus-starter-feeding-[0-9a-f]{12}\/tree$/);
    assert.equal(p.runs, 2 * 4 * 5, 'two tasks, four arms, five replicates');
    assert.match(p.commands.variantKeep, /cap variant --base v1\.2\.0 --add skill:release-codename=.*SKILL\.md --to-agent konductor/);
    assert.match(p.commands.run, /run --suite cap --arms .*--tasks control-keep,control-prune --replicates 5 --parallel 1/);
    assert.match(p.commands.run, /--extra-tasks/);
    assert.match(p.commands.check, /cap controls --check .* --base-arm base --aa base-b --keep ctl-keep --prune ctl-prune/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- evaluate ----

const row = (arm, task, q, outcome = 'good') => ({ arm, task, hidden: null, checks: q === null ? null : q / 100, rubric: null, outcome });
const many = (arm, task, q, n) => Array.from({ length: n }, () => row(arm, task, q));

test('evaluateControls: a planted lift found and a decoy with no effect means the study can be trusted', () => {
  const rows = [...many('base', 'control-keep', 0, 5), ...many('ctl-keep', 'control-keep', 100, 5), ...many('base', 'control-prune', 100, 5), ...many('ctl-prune', 'control-prune', 100, 5)];
  const r = C.evaluateControls({ rows, base: 'base', keep: 'ctl-keep', prune: 'ctl-prune' });
  assert.equal(r.keep.status, 'PASS');
  assert.equal(r.prune.status, 'PASS');
  assert.equal(r.trusted, true);
  assert.equal(r.keep.delta, 100);
  assert.match(r.summary, /can be trusted/);
});

test('evaluateControls: a missed planted lift fails the keep control and the study is not trusted', () => {
  const rows = [...many('base', 'control-keep', 0, 5), ...many('ctl-keep', 'control-keep', 10, 5), ...many('base', 'control-prune', 100, 5), ...many('ctl-prune', 'control-prune', 100, 5)];
  const r = C.evaluateControls({ rows, base: 'base', keep: 'ctl-keep', prune: 'ctl-prune' });
  assert.equal(r.keep.status, 'FAIL');
  assert.equal(r.trusted, false);
  assert.match(r.summary, /do not trust/i);
});

test('evaluateControls: an effect from the decoy fails the prune control', () => {
  const rows = [...many('base', 'control-keep', 0, 5), ...many('ctl-keep', 'control-keep', 100, 5), ...many('base', 'control-prune', 100, 5), ...many('ctl-prune', 'control-prune', 40, 5)];
  assert.equal(C.evaluateControls({ rows, base: 'base', keep: 'ctl-keep', prune: 'ctl-prune' }).prune.status, 'FAIL');
});

test('evaluateControls: under 3 runs a side is inconclusive, and the A/A spread widens the band', () => {
  const few = [...many('base', 'control-keep', 0, 2), ...many('ctl-keep', 'control-keep', 100, 2), ...many('base', 'control-prune', 100, 5), ...many('ctl-prune', 'control-prune', 100, 5)];
  const r = C.evaluateControls({ rows: few, base: 'base', keep: 'ctl-keep', prune: 'ctl-prune' });
  assert.equal(r.keep.status, 'INCONCLUSIVE');
  assert.equal(r.trusted, false);
  const noisy = [...many('base', 'control-prune', 100, 5), ...many('base-b', 'control-prune', 70, 5), ...many('ctl-prune', 'control-prune', 85, 5), ...many('base', 'control-keep', 0, 5), ...many('ctl-keep', 'control-keep', 100, 5)];
  const w = C.evaluateControls({ rows: noisy, base: 'base', aa: 'base-b', keep: 'ctl-keep', prune: 'ctl-prune' });
  assert.ok(Math.abs(w.band - 30) < 1e-9);
  assert.equal(w.prune.status, 'PASS', '15 points is inside a 30 point A/A spread');
});

test('evaluateControls: a timed-out run scores 0 and stays in; an infra error is left out and listed', () => {
  const rows = [...many('base', 'control-keep', 0, 3), ...many('ctl-keep', 'control-keep', 100, 3), row('ctl-keep', 'control-keep', 100, 'infraError'), row('ctl-keep', 'control-keep', null, 'timeout'), ...many('base', 'control-prune', 100, 3), ...many('ctl-prune', 'control-prune', 100, 3)];
  const r = C.evaluateControls({ rows, base: 'base', keep: 'ctl-keep', prune: 'ctl-prune' });
  assert.equal(r.keep.nHead, 4);
  assert.equal(r.keep.failedAsZero, 1);
  assert.equal(r.keep.delta, 75);
  assert.equal(r.keep.excluded.infraError, 1);
});
