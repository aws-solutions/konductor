// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun, write } = require('./helpers.js');
const { gradedSummary, gradedTable } = require('../../report/graded.js');
const { loadRun, loadRuns } = require('../../report/load.js');
const { generateRunReport } = require('../../report/generate.js');
const { loadTasks } = require('../lib/tasks.js');

const rec = (o) => ({ kind: 'graded', judge: 'j1', armId: 'a', taskId: 't1', replicate: 1, baselineId: 'vanilla', armGrade: 4, baseGrade: 2, delta: 2, orderDisagreement: false, shift: 0, judgeError: null, ...o });

// Three judges on each run: the panel takes the median per run (SR-24).
const three = (o, grades) => ['j1', 'j2', 'j3'].map((judge, i) => rec({ judge, ...o, ...grades[i] }));

test('gradedSummary takes the median of three judges per run, then the mean over runs; each judge keeps its own means', () => {
  const s = gradedSummary({ graded: [
    ...three({}, [{ armGrade: 4, baseGrade: 2, delta: 2 }, { armGrade: 5, baseGrade: 2, delta: 3 }, { armGrade: 1, baseGrade: 3, delta: -2 }]),
    ...three({ replicate: 2, orderDisagreement: true, shift: 2 }, [{ armGrade: 3, baseGrade: 3, delta: 0 }, { armGrade: 3, baseGrade: 3, delta: 0 }, { armGrade: 3, baseGrade: 3, delta: 0 }]),
    rec({ replicate: 3, judgeError: 'x', armGrade: null, baseGrade: null, delta: null }),
  ] });
  assert.equal(s.present, true);
  assert.equal(s.baselineId, 'vanilla');
  const a = s.arms.a;
  // run 1: medians arm 4, base 2, delta 2 (the means would be 3.33, 2.33, 1); run 2: 3, 3, 0.
  assert.deepEqual([a.n, a.records, a.noData, a.errors], [2, 6, 0, 1]);
  assert.deepEqual([a.armGrade, a.baseGrade, a.delta], [3.5, 2.5, 1]);
  assert.deepEqual([a.orderDisagreements, a.disagreementRate], [3, 0.5]);
  assert.deepEqual(Object.keys(a.judges), ['j1', 'j2', 'j3']);
  assert.deepEqual([a.judges.j3.armGrade, a.judges.j3.delta], [2, -1]);
  assert.deepEqual([s.total.n, s.total.errors, s.total.orderDisagreements], [6, 1, 3]);
});

test('a run graded by fewer than three judges is NO DATA in the panel grade, but each judge still shows', () => {
  const s = gradedSummary({ graded: [rec({}), rec({ judge: 'j2', armGrade: 5, delta: 3 })] });
  const a = s.arms.a;
  assert.deepEqual([a.n, a.noData, a.armGrade, a.records], [0, 1, null, 2]);
  assert.deepEqual(Object.keys(a.judges), ['j1', 'j2']);
  assert.match(gradedTable(s).rows[0].join(' | '), /0 \(2\), NO DATA 1 \| n\/a \| n\/a \| n\/a \| j1 4\.00 vs 2\.00 \(\+2\.00\); j2 5\.00 vs 2\.00 \(\+3\.00\)/);
});

test('gradedSummary is not present without graded records, and skips stale ones', () => {
  assert.equal(gradedSummary({ rubric: [] }).present, false);
  assert.equal(gradedSummary(null).present, false);
  const s = gradedSummary({ graded: [...three({ taskRevision: 'old' }, [{}, {}, {}]), ...three({ replicate: 2, taskRevision: 'new' }, [{}, {}, {}])] }, { isStale: (r) => r.taskRevision === 'old' });
  assert.equal(s.arms.a.n, 1);
});

test('gradedTable has one row per arm, the disagreement as n of m records, and a caveat when judges follow position', () => {
  const s = gradedSummary({ graded: [...three({ orderDisagreement: true }, [{}, {}, {}]), ...three({ replicate: 2, orderDisagreement: true }, [{}, {}, {}])] });
  const t = gradedTable(s);
  assert.deepEqual(t.head.slice(0, 3), ['arm', 'runs (records)', 'median grade (arm, 1-5)']);
  assert.equal(t.rows.length, 1);
  assert.match(t.rows[0].join(' | '), /6 of 6 \(100%\)/);
  assert.match(t.note, /median over judges per run/);
  assert.match(t.note, /follow position/);
});

test('loadRuns keeps graded records when run directories are merged, with the replicate remapped', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const mk = (name) => {
      const d = makeRun(path.join(root, name), bench, [{ arm: 'vanilla' }, { arm: 'a' }]);
      write(path.join(d, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'vanilla', judges: ['j1'], modes: ['graded'], rubric: [], pairwise: [], graded: [rec({})] }));
      return d;
    };
    const merged = loadRuns([mk('r1'), mk('r2')]);
    assert.deepEqual(merged.judgments.graded.map((g) => g.replicate).sort(), [1, 2]);
    assert.equal(loadRun(path.join(root, 'r1')).judgments.graded.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the full report has a graded judging section, and the quick one does not', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const d = makeRun(path.join(root, 'r'), bench, [{ arm: 'vanilla' }, { arm: 'a' }]);
    write(path.join(d, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'vanilla', judges: ['j1'], modes: ['graded'], rubric: [], pairwise: [], graded: [rec({ orderDisagreement: true })] }));
    const tasks = loadTasks(bench);
    const full = generateRunReport({ run: loadRun(d), tasks, baseline: 'vanilla', out: path.join(root, 'o1'), detail: 'full', format: 'md', defaultDir: d });
    const text = fs.readFileSync(full.written.find((w) => w.endsWith('report.md')), 'utf8');
    assert.match(text, /## Graded judging \(1 to 5\)/);
    assert.match(text, /1 of 1 \(100%\)/);
    const quick = generateRunReport({ run: loadRun(d), tasks, baseline: 'vanilla', out: path.join(root, 'o2'), detail: 'quick', format: 'md', defaultDir: d });
    assert.doesNotMatch(fs.readFileSync(quick.written.find((w) => w.endsWith('report.md')), 'utf8'), /Graded judging/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
