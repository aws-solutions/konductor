// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pre-registration lock: freeze, check, tampering, and the run and report refusals that read it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');
const prereg = require('../../scenarios/prereg.js');
const { splitOf } = require('../../scenarios/split.js');
const { PROTOCOL, BOOTSTRAP, MARGIN } = require('../../scenarios/protocol.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const task = (id, o = {}) => ({ id, version: 1, prompt: `Do ${id}.`, ...o });

function pack(ids = ['a-1', 'a-2', 'b-1', 'b-2', 'c-1']) {
  const dir = tmp();
  ids.forEach((id, i) => write(path.join(dir, i % 2 ? 'batch2' : 'batch1', `${id}.json`), `${JSON.stringify(task(id))}\n`));
  return dir;
}
const cli = (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: tmp() } });

test('freeze records ids, versions, file hashes and the recomputed split, and the protocol with its fixed numbers', () => {
  const dir = pack();
  const rec = prereg.freezePrereg(dir, { date: '2026-11-19' });
  assert.deepEqual(rec.tasks.map((t) => t.id), ['a-1', 'a-2', 'b-1', 'b-2', 'c-1']);
  assert.ok(rec.tasks.every((t) => t.version === 1 && /^[0-9a-f]{64}$/.test(t.sha256)));
  assert.equal(rec.tasks[0].file, 'batch1/a-1.json');
  assert.deepEqual([...rec.split.dev, ...rec.split.heldOut].sort(), rec.tasks.map((t) => t.id));
  for (const id of rec.split.dev) assert.equal(splitOf(id), 'DEV');
  assert.equal(rec.protocol.statistic.draws, 10000);
  assert.equal(rec.protocol.statistic.seed, BOOTSTRAP.seed);
  assert.equal(rec.protocol.margin, MARGIN);
  assert.equal(rec.protocol.margin, 5);
  assert.equal(JSON.stringify(rec.protocol), JSON.stringify(PROTOCOL));
  assert.deepEqual(prereg.checkPrereg(path.join(dir, 'PREREG.json'), dir), []);
});

test('freeze refuses a task without a version, a bad date, an empty pack, and an existing lock', () => {
  const noVersion = tmp();
  write(path.join(noVersion, 'x.json'), JSON.stringify({ id: 'x', prompt: 'p' }));
  assert.throws(() => prereg.freezePrereg(noVersion, { date: '2026-11-19' }), /needs an integer version.*x/);
  assert.throws(() => prereg.freezePrereg(pack(), { date: 'yesterday' }), /YYYY-MM-DD/);
  assert.throws(() => prereg.freezePrereg(tmp(), { date: '2026-11-19' }), /no task files/);
  const dir = pack();
  prereg.freezePrereg(dir, { date: '2026-11-19' });
  assert.throws(() => prereg.freezePrereg(dir, { date: '2026-11-19' }), /already exists/);
});

test('check names an edited task file, a removed one and an added one', () => {
  const dir = pack();
  prereg.freezePrereg(dir, { date: '2026-11-19' });
  const lock = path.join(dir, 'PREREG.json');
  write(path.join(dir, 'batch1/a-1.json'), `${JSON.stringify(task('a-1', { prompt: 'edited' }))}\n`);
  fs.rmSync(path.join(dir, 'batch2/a-2.json'));
  write(path.join(dir, 'batch1/new-1.json'), `${JSON.stringify(task('new-1'))}\n`);
  const problems = prereg.checkPrereg(lock, dir);
  assert.ok(problems.some((p) => /^a-1: the task file changed since the lock \(same version\)/.test(p)));
  assert.ok(problems.some((p) => /^a-2: locked but no task file now/.test(p)));
  assert.ok(problems.some((p) => /^new-1: a task file that is not in the lock/.test(p)));
});

test('check reports a version bump, an edited lock, a moved split list and a changed protocol', () => {
  const dir = pack();
  prereg.freezePrereg(dir, { date: '2026-11-19' });
  const lock = path.join(dir, 'PREREG.json');
  write(path.join(dir, 'batch1/a-1.json'), `${JSON.stringify(task('a-1', { version: 2 }))}\n`);
  assert.ok(prereg.checkPrereg(lock, dir).some((p) => /version 1 to 2/.test(p)));

  const rec = JSON.parse(fs.readFileSync(lock, 'utf8'));
  const moved = { ...rec, split: { ...rec.split, dev: [...rec.split.heldOut.slice(0, 1), ...rec.split.dev], heldOut: rec.split.heldOut.slice(1) } };
  fs.writeFileSync(lock, JSON.stringify(moved));
  const p1 = prereg.checkPrereg(lock, dir);
  assert.ok(p1.some((p) => /DEV and HELD-OUT lists do not match the SR-32/.test(p)));
  assert.ok(p1.some((p) => /lock hash does not match/.test(p)), 'an edit without a new hash is seen');

  const rehashed = { ...moved, lockHash: undefined };
  rehashed.lockHash = prereg.lockHashOf(rehashed);
  fs.writeFileSync(lock, JSON.stringify(rehashed));
  const p2 = prereg.checkPrereg(lock, dir);
  assert.ok(p2.some((p) => /SR-32/.test(p)), 'a re-hashed lock still fails the split rule');
  assert.ok(!p2.some((p) => /lock hash/.test(p)));

  const protocolEdit = { ...rec, protocol: { ...rec.protocol, margin: 3 } };
  protocolEdit.lockHash = prereg.lockHashOf(protocolEdit);
  fs.writeFileSync(lock, JSON.stringify(protocolEdit));
  assert.ok(prereg.checkPrereg(lock, dir).some((p) => /protocol in the lock differs/.test(p)));
});

test('checkRun accepts locked tasks read from the batch directories and refuses others, naming each', () => {
  const dir = pack();
  prereg.freezePrereg(dir, { date: '2026-11-19' });
  const lock = path.join(dir, 'PREREG.json');
  const dirs = [path.join(dir, 'batch1'), path.join(dir, 'batch2')];
  assert.doesNotThrow(() => prereg.checkRun(lock, { taskIds: ['a-1', 'b-1'], extraDirs: dirs }));
  assert.throws(() => prereg.checkRun(lock, { taskIds: ['zzz'], extraDirs: dirs }), /zzz: not in the pre-registration lock/);
  assert.throws(() => prereg.checkRun(lock, { taskIds: ['a-2'], extraDirs: [dirs[0]] }), /a-2: its task file is not in the --extra-tasks/);
  write(path.join(dir, 'batch1/a-1.json'), `${JSON.stringify(task('a-1', { prompt: 'edited' }))}\n`);
  assert.throws(() => prereg.checkRun(lock, { taskIds: ['a-1'], extraDirs: dirs }), /a-1: the task file differs from the locked one/);
  assert.throws(() => prereg.requirePrereg({ prereg: true }, { taskIds: [], extraDirs: [] }), /takes the path/);
});

/** A konductor tree with one skill, for the freeze gates' lint and coverage. */
function konductorTree() {
  const tree = tmp();
  write(path.join(tree, 'skills/plan-review/SKILL.md'), '---\nname: plan-review\ndescription: Use when reviewing a plan.\n---\n\n# P\n');
  return tree;
}

test('freeze runs the lint and the coverage gate first: a lint finding refuses, gaps refuse unless accepted, and the lock records them (D-55)', () => {
  const tree = konductorTree();
  const dir = pack();
  const plain = cli(['scenarios', 'prereg', 'freeze', dir, '--date', '2026-11-19', '--base', `dir:${tree}`]);
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /coverage hole: skill:plan-review/);
  assert.match(plain.stderr, /--accept-gaps/);
  assert.equal(fs.existsSync(path.join(dir, 'PREREG.json')), false, 'nothing is written');
  const leaky = pack();
  write(path.join(leaky, 'batch1/a-1.json'), `${JSON.stringify(task('a-1', { prompt: 'Run plan-review on it.' }))}\n`);
  const refused = cli(['scenarios', 'prereg', 'freeze', leaky, '--date', '2026-11-19', '--base', `dir:${tree}`, '--accept-gaps', 'a test pack']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /lint: a-1: names-unit/);
  const ok = cli(['scenarios', 'prereg', 'freeze', dir, '--date', '2026-11-19', '--base', `dir:${tree}`, '--accept-gaps', 'a test pack']);
  assert.equal(ok.status, 0, ok.stderr);
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'PREREG.json'), 'utf8'));
  assert.equal(lock.gates.coverage.acceptedBecause, 'a test pack');
  assert.ok(lock.gates.coverage.holes.includes('skill:plan-review'));
  assert.equal(lock.gates.lint.new, 0);
  assert.deepEqual(prereg.checkPrereg(path.join(dir, 'PREREG.json'), dir), []);
  assert.equal(cli(['scenarios', 'prereg', 'freeze', pack(), '--date', '2026-11-19']).status, 2, 'freeze needs --base');
});

test('the CLI freezes (exit 0), checks (0 then 1 after an edit), and refuses a missing action or directory (2)', () => {
  const dir = pack();
  const frozen = cli(['scenarios', 'prereg', 'freeze', dir, '--date', '2026-11-19', '--base', `dir:${konductorTree()}`, '--accept-gaps', 'a test pack']);
  assert.equal(frozen.status, 0, frozen.stderr);
  assert.match(frozen.stdout, /5 task\(s\) \(\d+ DEV, \d+ HELD-OUT\)/);
  assert.equal(cli(['scenarios', 'prereg', 'check', dir]).status, 0);
  write(path.join(dir, 'batch1/a-1.json'), `${JSON.stringify(task('a-1', { prompt: 'edited' }))}\n`);
  const bad = cli(['scenarios', 'prereg', 'check', dir]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /prereg: a-1: the task file changed/);
  assert.equal(cli(['scenarios', 'prereg', 'freeze']).status, 2);
  assert.equal(cli(['scenarios', 'prereg', 'oops', dir]).status, 2);
});

test('run refuses to start when a selected task differs from the lock, before any arm is built', () => {
  const dir = tmp();
  const bench = makeBench(path.join(tmp(), 'bench'));
  const valid = (o = {}) => `${JSON.stringify({ id: 'a-1', version: 1, class: 'simple', target: null, prompt: 'Fix it.', fixture: 'fx', timeoutSec: 60, checks: [], rubric: [], tiers: ['lite'], ...o })}\n`;
  write(path.join(dir, 'batch1/a-1.json'), valid());
  prereg.freezePrereg(dir, { date: '2026-11-19' });
  write(path.join(dir, 'batch1/a-1.json'), valid({ prompt: 'Fix it differently.' }));
  const base = ['run', '--suite', 'lite', '--arms', 'vanilla', '--bench-dir', bench, '--extra-tasks', path.join(dir, 'batch1'), '--tasks', 'a-1', '--prereg', path.join(dir, 'PREREG.json'), '--out', path.join(tmp(), 'out')];
  const r = cli(base);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not match the pre-registration lock[\s\S]*a-1: the task file differs from the locked one/);
});
