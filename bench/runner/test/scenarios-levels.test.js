// SPDX-License-Identifier: Apache-2.0
'use strict';

// Run levels: the LITE selection rule, STANDARD, FULL, the record and the report header line.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');
const { selectLevel, planLevel, levelRecord, levelHeader, LITE_PHASES } = require('../../scenarios/konductor/levels.js');
const { splitOf, hashOf } = require('../../scenarios/split.js');
const { CORE_PHASES, ADDED_PHASES } = require('../../scenarios/coverage.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

// n ids of the given split, found by search, so no hash is hard-coded.
const ids = (split, n, prefix) => {
  const out = [];
  for (let i = 0; out.length < n; i++) if (splitOf(`${prefix}-${i}`) === split) out.push(`${prefix}-${i}`);
  return out;
};
const task = (id, o = {}) => ({ id, phase: 'bugfix', role: 'developer', limits: { softSec: 600, hardSec: 1200 }, ...o });

// Two real DEV tasks and one HELD-OUT task in each of the 14 phases, cycling the roles, plus controls.
function pack() {
  const roles = ['pm', 'tpm', 'architect', 'developer', 'frontend', 'qa', 'security', 'sre', 'reviewer'];
  const tasks = [];
  LITE_PHASES.forEach((phase, i) => {
    const [a, b] = ids('DEV', 2, `${phase}-d`);
    tasks.push(task(a, { phase, role: roles[i % roles.length] }), task(b, { phase, role: roles[(i + 3) % roles.length] }));
    tasks.push(task(ids('HELD-OUT', 1, `${phase}-h`)[0], { phase, role: roles[i % roles.length] }));
  });
  tasks.push(task(ids('DEV', 1, 'long')[0], { phase: 'multi-phase', role: 'developer' }));
  const [n1, n2] = ids('DEV', 2, 'neg');
  const [w1, w2] = ids('DEV', 2, 'twin');
  tasks.push(task(n1, { controlKind: 'negative' }), task(n2, { controlKind: 'negative' }), task(w1, { controlKind: 'twin', twinOf: tasks[0].id }), task(w2, { controlKind: 'twin', twinOf: tasks[0].id }));
  tasks.push(task(ids('HELD-OUT', 1, 'negh')[0], { controlKind: 'negative' }));
  return tasks;
}
const byId = (tasks) => new Map(tasks.map((t) => [t.id, t]));

test('LITE takes, for each of the 14 phases, the DEV real task with the lowest hash, and the lowest-hash DEV negative control and twin', () => {
  const tasks = pack();
  const sel = selectLevel({ level: 'lite', tasks });
  const m = byId(tasks);
  for (const phase of LITE_PHASES) {
    const dev = tasks.filter((t) => t.phase === phase && !t.controlKind && splitOf(t.id) === 'DEV').sort((x, y) => hashOf(x.id) - hashOf(y.id));
    assert.ok(sel.ids.includes(dev[0].id) || sel.picks.some((p) => m.get(p.id).phase === phase), phase);
  }
  assert.equal(sel.picks.filter((p) => /^phase /.test(p.why)).length, 14);
  assert.ok(sel.picks.every((p) => splitOf(p.id) === 'DEV'));
  assert.ok(!sel.ids.some((id) => m.get(id).phase === 'multi-phase'));
  const neg = tasks.filter((t) => t.controlKind === 'negative' && splitOf(t.id) === 'DEV').sort((x, y) => hashOf(x.id) - hashOf(y.id))[0];
  const twin = tasks.filter((t) => t.controlKind === 'twin').sort((x, y) => hashOf(x.id) - hashOf(y.id))[0];
  assert.ok(sel.ids.includes(neg.id) && sel.ids.includes(twin.id));
  assert.equal(sel.ids.length, 16);
  assert.match(sel.listHash, /^[0-9a-f]{64}$/);
});

test('a task over the 900 s soft limit is skipped even when its hash is the lowest', () => {
  const tasks = pack();
  const phase = 'testing';
  const dev = tasks.filter((t) => t.phase === phase && splitOf(t.id) === 'DEV').sort((x, y) => hashOf(x.id) - hashOf(y.id));
  dev[0].limits = { softSec: 901, hardSec: 1800 };
  const sel = selectLevel({ level: 'lite', tasks });
  assert.ok(!sel.ids.includes(dev[0].id));
  assert.ok(sel.ids.includes(dev[1].id));
  dev[0].limits = { softSec: 900, hardSec: 1800 };
  assert.ok(selectLevel({ level: 'lite', tasks }).ids.includes(dev[0].id), '900 is allowed');
});

test('a role the phase picks leave out is swapped in from a phase with two or more tasks; with no way to swap it is reported', () => {
  const tasks = [];
  // Phase A: two DEV tasks (roles pm, qa); phase B: one DEV task (pm). The lowest-hash picks are both pm, so qa is missing.
  const [a1, a2] = ids('DEV', 2, 'swapA');
  const [b1] = ids('DEV', 1, 'swapB');
  const lowFirst = [a1, a2].sort((x, y) => hashOf(x) - hashOf(y));
  tasks.push(task(lowFirst[0], { phase: 'testing', role: 'pm' }), task(lowFirst[1], { phase: 'testing', role: 'qa' }), task(b1, { phase: 'planning', role: 'pm' }));
  const sel = selectLevel({ level: 'lite', tasks });
  assert.deepEqual(sel.picks.filter((p) => /phase/.test(p.why)).map((p) => p.id).sort(), [lowFirst[1], b1].sort());
  assert.ok(sel.picks.some((p) => /swapped in for role qa/.test(p.why)));
  assert.ok(sel.unfilled.includes('tpm'), 'roles with no task at all stay unfilled');
  assert.ok(!sel.unfilled.includes('qa'));
});

test('tasks added or changed since the last LITE join as smoke only', () => {
  const tasks = pack();
  const first = selectLevel({ level: 'lite', tasks });
  const hashes = new Map(tasks.map((t) => [t.id, `h-${t.id}`]));
  const since = first.ids.map((id) => ({ id, sha256: hashes.get(id) }));
  assert.deepEqual(selectLevel({ level: 'lite', tasks, hashes, since }).smoke.length, tasks.length - first.ids.length, 'tasks never seen are all smoke');
  const seenAll = tasks.map((t) => ({ id: t.id, sha256: hashes.get(t.id) }));
  assert.deepEqual(selectLevel({ level: 'lite', tasks, hashes, since: seenAll }).smoke, []);
  const changed = new Map(hashes).set(tasks[2].id, 'different');
  const sel = selectLevel({ level: 'lite', tasks, hashes: changed, since: seenAll });
  assert.deepEqual(sel.smoke, first.ids.includes(tasks[2].id) ? [] : [tasks[2].id]);
  assert.throws(() => selectLevel({ level: 'standard', tasks, since }), /lite only/);
});

test('STANDARD is every DEV task including controls; FULL is every task; the list hash ignores order', () => {
  const tasks = pack();
  const std = selectLevel({ level: 'standard', tasks });
  assert.deepEqual(std.ids, tasks.filter((t) => splitOf(t.id) === 'DEV').map((t) => t.id).sort());
  const full = selectLevel({ level: 'full', tasks });
  assert.equal(full.ids.length, tasks.length);
  assert.equal(selectLevel({ level: 'full', tasks: [...tasks].reverse() }).listHash, full.listHash);
  assert.notEqual(std.listHash, full.listHash);
  assert.throws(() => selectLevel({ level: 'huge', tasks }), /lite, standard, full/);
});

test('planLevel refuses --tasks beside --level, FULL without --prereg, and an empty selection; it records the picks and file hashes', () => {
  const dir = tmp();
  const t = { id: ids('DEV', 1, 'plan')[0], version: 1, prompt: 'p', phase: 'bugfix', role: 'developer', limits: { softSec: 100, hardSec: 200 } };
  write(path.join(dir, `${t.id}.json`), JSON.stringify(t));
  assert.throws(() => planLevel({ level: 'lite', tasks: 'x' }, { candidates: [t], extraDirs: [dir] }), /both select tasks/);
  assert.throws(() => planLevel({ level: 'full' }, { candidates: [t], extraDirs: [dir] }), /needs? .*--prereg|give --prereg/);
  assert.throws(() => planLevel({ level: 'lite' }, { candidates: [], extraDirs: [dir] }), /selects no task/);
  assert.equal(planLevel({}, { candidates: [t], extraDirs: [dir] }), null);
  const plan = planLevel({ level: 'lite' }, { candidates: [t], extraDirs: [dir] });
  assert.deepEqual(plan.sel.ids, [t.id]);
  assert.equal(plan.record.name, 'lite');
  assert.equal(plan.record.taskCount, 1);
  assert.match(plan.record.tasks[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(levelRecord(plan.sel).tasks, [{ id: t.id, sha256: null }]);
});

test('the report header line names the level, the count and the list hash, says what it may support, and flags cells that differ', () => {
  const rec = (name, n, hash, extra = {}) => ({ name, taskCount: n, listHash: hash.repeat(64).slice(0, 64), smokeOnly: [], unfilledRoles: [], ...extra });
  assert.equal(levelHeader([{ cell: 'a', level: null }]), null);
  const one = levelHeader([{ cell: 'a', level: rec('lite', 16, 'ab') }, { cell: 'b', level: rec('lite', 16, 'ab') }]);
  assert.match(one, /^Run level: LITE, 16 tasks \(list abababababab\)\. LITE is a smoke test/);
  assert.match(levelHeader([{ cell: 'a', level: rec('lite', 16, 'ab', { smokeOnly: ['x'], unfilledRoles: ['qa'] }) }]), /1 smoke only, no task for role qa/);
  assert.match(levelHeader([{ cell: 'a', level: rec('standard', 50, 'cd') }]), /direction only/);
  assert.match(levelHeader([{ cell: 'a', level: rec('lite', 16, 'ab') }, { cell: 'b', level: rec('full', 150, 'cd') }]), /Run level differs between cells: a: LITE.*; b: FULL/);
  assert.match(levelHeader([{ cell: 'a', level: rec('lite', 16, 'ab') }, { cell: 'b', level: null }]), /b: not recorded/);
});

test('the CLI refuses --level full without --prereg and --level beside --tasks, before any run starts', () => {
  const bench = makeBench(path.join(tmp(), 'bench'));
  const cli = (args) => spawnSync(process.execPath, [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--bench-dir', bench, '--out', path.join(tmp(), 'out'), ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: tmp() } });
  const full = cli(['--level', 'full']);
  assert.notEqual(full.status, 0);
  assert.match(full.stderr, /--level full is the pre-registered run: give --prereg FILE/);
  const both = cli(['--level', 'lite', '--tasks', 't1']);
  assert.match(both.stderr, /--level and --tasks both select tasks/);
  // The LITE rule reads the plan's 15 core phases minus multi-phase; phases added later (T13) stay out of it.
  assert.equal(CORE_PHASES.length - 1, LITE_PHASES.length);
  assert.equal(LITE_PHASES.length, 14);
  for (const p of ADDED_PHASES) assert.ok(!LITE_PHASES.includes(p));
});
