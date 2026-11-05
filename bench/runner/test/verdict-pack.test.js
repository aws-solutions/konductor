// SPDX-License-Identifier: Apache-2.0
'use strict';

// report --verdict with --criteria-pack: the pack-weighted quality score feeds the paired intervals and the verdict.
// The default verdict, without the flag, is unchanged.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixtureRun, mk, write } = require('./verdict-fixtures.js');
const { loadTasks } = require('../lib/tasks.js');
const { loadPack } = require('../../judge/pack/index.js');
const { taskRevision } = require('../../judge/revision.js');
const { generateVerdict } = require('../../report/verdictgen.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const pack = loadPack('quality');
const WEIGHTS = { hidden: 0.4, checks: 0.16, rubric: 0.24, pack: 0.2 };
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

function setup({ judgePack = true } = {}) {
  const root = mk();
  const { dir, benchDir } = fixtureRun(root, 'run', { arms: { vanilla: { hidden: [8] }, other: { hidden: [8], sha: 'a' } }, reps: 3, tasks: ['t1', 't2'] });
  const tasks = loadTasks(benchDir);
  if (judgePack) {
    const records = [];
    for (const arm of ['vanilla', 'other']) {
      for (const task of ['t1', 't2']) {
        for (let rep = 1; rep <= 3; rep++) {
          const verdict = arm === 'vanilla' || rep === 1 ? 'pass' : 'fail';
          records.push({ judge: 'j1', armId: arm, taskId: task, replicate: rep, taskRevision: taskRevision(tasks.get(task)), packRevision: pack.revision, dimensions: {}, judgeError: null, criteria: [{ id: 'chg-scoped', dimension: 'change-discipline', status: 'judged', verdict }], na: [] });
        }
      }
    }
    write(path.join(dir, 'judgments-quality.json'), JSON.stringify({ schemaVersion: 1, kind: 'quality-pack', pack: { id: pack.id, revision: pack.revision }, backend: 'kiro', judges: ['j1'], notJudged: [], records }));
  }
  const scoring = path.join(root, 'scoring-pack.json');
  write(scoring, JSON.stringify({ weights: WEIGHTS }));
  return { root, dir, benchDir, scoring };
}

const verdictOf = (s, extra = {}) => generateVerdict({ kind: 'platform', dirs: [s.dir], benchDir: s.benchDir, baseline: 'vanilla', out: path.join(s.root, 'out'), format: 'md', ...extra }).v;

test('with the pack weighted, the verdict scores each run on the pack too, and the paired interval moves', () => {
  const s = setup();
  try {
    const plain = verdictOf(s);
    assert.equal(plain.arms.find((a) => a.label !== plain.baselineLabel).quality.delta, 0, 'equal hidden tests and no pack: no difference');
    const withPack = verdictOf(s, { scoringFile: s.scoring, qualityPack: pack });
    const arm = withPack.arms.find((a) => a.label !== withPack.baselineLabel);
    assert.ok(arm.quality.delta < -1, `pack failures lower the arm: ${arm.quality.delta}`);
    assert.ok(Number.isFinite(arm.quality.deltaCiLow) && Number.isFinite(arm.quality.deltaCiHigh));
  } finally { cleanup(s.root); }
});

test('the pack-weighted verdict refuses runs without current pack judgments, and a pack weight without the pack', () => {
  const s = setup({ judgePack: false });
  try {
    assert.throws(() => verdictOf(s, { scoringFile: s.scoring, qualityPack: pack }), /judgments-quality\.json/);
    assert.throws(() => verdictOf(s, { scoringFile: s.scoring }), /needs the quality-pack scores/);
  } finally { cleanup(s.root); }
});

test('the orchestrator-pass verdict takes the pack too', () => {
  const s = setup();
  try {
    const run = (o) => generateVerdict({ kind: 'orchestrator-pass', dirs: [s.dir], benchDir: s.benchDir, baseline: 'vanilla', out: path.join(s.root, 'out2'), format: 'md', ...o }).v;
    const plain = run({});
    const withPack = run({ scoringFile: s.scoring, qualityPack: pack });
    const delta = (v) => v.cells[0].arms.find((a) => !a.aaRepeatOf).quality.delta;
    assert.equal(delta(plain), 0);
    assert.ok(delta(withPack) < -1);
    assert.throws(() => run({ scoringFile: s.scoring }), /needs the quality-pack scores/);
  } finally { cleanup(s.root); }
});

test('report --verdict --criteria-pack needs a scoring file that weights the pack, and runs with one', () => {
  const s = setup();
  try {
    const env = { PATH: process.env.PATH, HOME: mk(), TMPDIR: process.env.TMPDIR };
    const base = [BENCH_JS, 'report', '--verdict', 'platform', '--run', s.dir, '--bench-dir', s.benchDir, '--criteria-pack', 'quality'];
    const refused = spawnSync(process.execPath, [...base, '--out', path.join(s.root, 'o1')], { encoding: 'utf8', env });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /needs a scoring file that gives the pack a weight/);
    const ok = spawnSync(process.execPath, [...base, '--scoring', s.scoring, '--out', path.join(s.root, 'o2')], { encoding: 'utf8', env });
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(fs.existsSync(path.join(s.root, 'o2', 'verdict.json')));
    const shipped = path.join(__dirname, '..', '..', 'profiles', 'scoring-quality-fractional.json');
    const fractional = spawnSync(process.execPath, [...base, '--scoring', shipped, '--out', path.join(s.root, 'o3')], { encoding: 'utf8', env });
    assert.equal(fractional.status, 0, fractional.stderr);
  } finally { cleanup(s.root); }
});

test('without the flag the verdict is the same whether the pack argument is absent or null', () => {
  const s = setup({ judgePack: false });
  try {
    const a = verdictOf(s);
    const b = verdictOf(s, { qualityPack: null });
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  } finally { cleanup(s.root); }
});
