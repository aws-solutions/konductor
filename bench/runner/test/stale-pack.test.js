// SPDX-License-Identifier: Apache-2.0
'use strict';

// packScores on runs judged against another pack or task revision: strict by default, labelled when allowStale is set.
// Synthetic judgment files in a scratch dir; no runner start.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { loadTasks } = require('../lib/tasks.js');
const { loadPack } = require('../../judge/pack/index.js');
const { taskRevision } = require('../../judge/revision.js');
const { loadRun } = require('../../report/load.js');
const { packScores, staleNote } = require('../../report/packscore.js');
const { checkArgs } = require('../lib/cli-flags.js');
const { parseArgs } = require('../bench.js');

const pack = loadPack('quality');
const crit = (id, verdict) => ({ id, dimension: 'x', status: 'judged', verdict });

function packRun(records) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', task: 't1' }, { arm: 'other', task: 't1' }], { taskIds: ['t1'] });
  const tasks = loadTasks(bench);
  const rev = taskRevision(tasks.get('t1'));
  const full = records.map((r) => ({ judge: 'j1', armId: 'vanilla', taskId: 't1', replicate: 1, taskRevision: rev, packRevision: pack.revision, dimensions: {}, judgeError: null, criteria: [], na: [], ...r }));
  write(path.join(runDir, 'judgments-quality.json'), JSON.stringify({ schemaVersion: 1, kind: 'quality-pack', pack: { id: pack.id, revision: pack.revision }, backend: 'kiro', judges: ['j1'], notJudged: [], records: full }));
  return { root, tasks, run: loadRun(runDir), rev };
}
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });
const CURRENT = { criteria: [crit('chg-scoped', 'pass')] };

test('strict by default: a run judged against another pack revision still throws, and the message names the opt-in', () => {
  const t = packRun([CURRENT, { armId: 'other', packRevision: 'old1', criteria: [crit('chg-scoped', 'pass')] }]);
  try {
    assert.throws(() => packScores({ run: t.run, tasks: t.tasks, pack }), /another pack revision or another task revision \(other\/t1\/1\).*--allow-stale-pack/);
    assert.throws(() => packScores({ run: t.run, tasks: t.tasks, pack, allowStale: false }), /another pack revision/);
  } finally { cleanup(t.root); }
});

test('allowStale scores a run from a stale pack revision and labels it', () => {
  const t = packRun([CURRENT, { armId: 'other', packRevision: 'old1', criteria: [crit('chg-tests-intact', 'pass'), crit('chg-scoped', 'fail')] }]);
  try {
    const s = packScores({ run: t.run, tasks: t.tasks, pack, allowStale: true });
    assert.equal(s.scoreOf('vanilla', 't1', 1), 1);
    assert.ok(Math.abs(s.scoreOf('other', 't1', 1) - 0.6) < 1e-9);
    assert.deepEqual(s.stale, [{ arm: 'other', task: 't1', rep: 1, label: 'stale pack revision old1' }]);
    const note = staleNote(s.stale, pack);
    assert.match(note, /1 run\(s\) have a pack score from stale judgments/);
    assert.match(note, /other\/t1\/1: stale pack revision old1/);
    assert.match(note, new RegExp(`current pack revision is ${pack.revision}`));
  } finally { cleanup(t.root); }
});

test('allowStale labels a stale task revision and prefers a current record when the run has both', () => {
  const t = packRun([
    { armId: 'vanilla', taskRevision: 'old-task', criteria: [crit('chg-scoped', 'fail')] },
    { armId: 'other', criteria: [crit('chg-scoped', 'pass')] },
    { armId: 'other', judge: 'j2', packRevision: 'old2', criteria: [crit('chg-scoped', 'fail')] },
  ]);
  try {
    const s = packScores({ run: t.run, tasks: t.tasks, pack, allowStale: true });
    assert.equal(s.scoreOf('vanilla', 't1', 1), 0);
    assert.equal(s.scoreOf('other', 't1', 1), 1);
    assert.deepEqual(s.stale.map((x) => `${x.arm}: ${x.label}`), [`vanilla: stale pack revision ${pack.revision} (the task changed since it was judged)`]);
  } finally { cleanup(t.root); }
});

test('allowStale still throws for a run the pack never judged, and records with a judge error are not scored', () => {
  const never = packRun([CURRENT]);
  try {
    assert.throws(() => packScores({ run: never.run, tasks: never.tasks, pack, allowStale: true }), /1 run\(s\) were never judged by the pack \(other\/t1\/1\)/);
  } finally { cleanup(never.root); }
  const errored = packRun([CURRENT, { armId: 'other', packRevision: 'old1', judgeError: 'boom', criteria: [crit('chg-scoped', 'pass')] }]);
  try {
    assert.throws(() => packScores({ run: errored.run, tasks: errored.tasks, pack, allowStale: true }), /other\/t1\/1/);
  } finally { cleanup(errored.root); }
});

test('with no stale runs the result is unchanged and carries an empty stale list and no note', () => {
  const t = packRun([CURRENT, { armId: 'other', criteria: [crit('chg-scoped', 'fail')] }]);
  try {
    const s = packScores({ run: t.run, tasks: t.tasks, pack, allowStale: true });
    assert.deepEqual(s.stale, []);
    assert.equal(staleNote(s.stale, pack), null);
    assert.equal(s.scoreOf('other', 't1', 1), 0);
  } finally { cleanup(t.root); }
});

test('report accepts --allow-stale-pack as a boolean flag; other commands reject it', () => {
  const opts = parseArgs(['--run', 'd', '--allow-stale-pack', '--criteria-pack', 'quality']);
  assert.equal(opts['allow-stale-pack'], true);
  assert.equal(opts['criteria-pack'], 'quality');
  assert.equal(checkArgs('report', opts), null);
  assert.match(checkArgs('report-2x2', parseArgs(['--allow-stale-pack'])), /unknown flag --allow-stale-pack/);
});

test('the run report refuses stale pack judgments by default and, with allowStalePack, opens with the label and lists them in report.json', () => {
  const { generateRunReport } = require('../../report/generate.js');
  const scoringFile = path.join(__dirname, '..', '..', 'profiles', 'scoring-quality.json');
  const t = packRun([CURRENT, { armId: 'other', packRevision: 'old1', criteria: [crit('chg-scoped', 'fail')] }]);
  try {
    const go = (name, extra) => generateRunReport({ run: loadRun(t.run.dir), tasks: t.tasks, baseline: 'vanilla', out: path.join(t.root, name), detail: 'full', format: 'both', defaultDir: t.run.dir, qualityPack: pack, scoringFile, ...extra });
    assert.throws(() => go('strict', {}), /another pack revision/);
    go('lenient', { allowStalePack: true });
    const md = fs.readFileSync(path.join(t.root, 'lenient', 'report.md'), 'utf8');
    assert.match(md, /other\/t1\/1: stale pack revision old1/);
    const json = JSON.parse(fs.readFileSync(path.join(t.root, 'lenient', 'report.json'), 'utf8'));
    assert.deepEqual(json.packStale, [{ arm: 'other', task: 't1', rep: 1, label: 'stale pack revision old1' }]);
  } finally { cleanup(t.root); }
});
