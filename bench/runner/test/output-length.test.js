// SPDX-License-Identifier: Apache-2.0
'use strict';

// Output length in stamped reports: means per arm and scope, a diligence warning against the baseline arm, and a within-task
// rank correlation with the rubric score in contrast and compare. Older (unstamped) reports do not change.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { buildStudy } = require('./rubric-policy-fixture.js');
const L = require('../../report/length.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');
const { analyze } = require('../../report/generate.js');
const { contrastRun, renderContrast } = require('../../report/contrast.js');
const { compareRuns, formatCompare } = require('../../report/compare.js');

const STAMP = 'excluded-as-failures';
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('withinTaskSpearman: one task is the plain Spearman coefficient, checked by hand', () => {
  // ranks of y are 2,1,4,3,6,5: sum of squared rank differences is 6, so rho = 1 - 6*6/(6*35) = 29/35
  const pts = [1, 2, 3, 4, 5, 6].map((x, i) => ({ task: 'a', x, y: [2, 1, 4, 3, 6, 5][i] }));
  const r = L.withinTaskSpearman(pts);
  assert.equal(r.n, 6);
  near(r.rho, 29 / 35);
  near(L.withinTaskSpearman(pts.map((p) => ({ ...p, y: -p.y }))).rho, -29 / 35);
});

test('withinTaskSpearman: ties share the mean rank', () => {
  // x ranks 1.5, 1.5, 3 and y ranks 1, 2, 3, centred on 2: sxy = 1.5, sxx = 1.5, syy = 2, rho = 1.5 / sqrt(3)
  const r = L.withinTaskSpearman([{ task: 'a', x: 5, y: 1 }, { task: 'a', x: 5, y: 2 }, { task: 'a', x: 9, y: 3 }]);
  near(r.rho, 1.5 / Math.sqrt(3));
});

test('withinTaskSpearman: ranks are taken inside a task, so a task that is long and scores high does not make a correlation', () => {
  const pts = [
    ...[101, 102, 103].map((x, i) => ({ task: 'a', x, y: [0.9, 0.7, 0.8][i] })),
    ...[1, 2, 3].map((x, i) => ({ task: 'b', x, y: [0.2, 0.4, 0.3][i] })),
  ];
  // centred ranks: task a x -1,0,1 and y 1,-1,0; task b x -1,0,1 and y -1,1,0; the products sum to 0
  assert.deepEqual(L.withinTaskSpearman(pts), { n: 6, rho: 0 });
  assert.ok(L.withinTaskSpearman(pts.map((p) => ({ task: 'all', x: p.x, y: p.y }))).rho > 0.5);
});

test('withinTaskSpearman: no spread on one side has no coefficient', () => {
  assert.equal(L.withinTaskSpearman([1, 2, 3].map((x) => ({ task: 'a', x, y: 0.5 }))).rho, null);
  assert.equal(L.withinTaskSpearman([{ task: 'a', x: 1, y: 1 }]).rho, null);
});

test('correlationLine is left out below six runs and states n from six', () => {
  const pts = (n) => Array.from({ length: n }, (_, i) => ({ task: 'a', x: i, y: i }));
  assert.equal(L.correlationLine(pts(5)), null);
  assert.equal(L.correlationLine([]), null);
  assert.match(L.correlationLine(pts(6)), /Spearman rank correlation between artifact bytes and rubric score, ranked within each task, 1\.00 over 6 run\(s\)/);
  assert.equal(L.correlationLine([...pts(5), { task: 'a', x: null, y: 1 }]), null);
});

const cell = (finalChars, artifactBytes) => ({ length: { finalChars: { n: 3, mean: finalChars }, artifactBytes: { n: 3, mean: artifactBytes } } });

test('lengthOutliers: a ratio of exactly 1.5 either way is not flagged, just beyond it is', () => {
  const at = (v) => L.lengthOutliers({ ref: cell(1000, 1000), arm: cell(1000, v) }, 'ref');
  assert.deepEqual(at(1500), []);
  assert.deepEqual(at(1501).map((o) => [o.arm, o.measure]), [['arm', 'artifactBytes']]);
  assert.deepEqual(at(1000 / 1.5 + 0.01), []);
  assert.deepEqual(at(1000 / 1.5 - 0.01).map((o) => o.measure), ['artifactBytes']);
});

test('lengthOutliers: each measure is checked on its own and the ratio is arm over reference', () => {
  const out = L.lengthOutliers({ ref: cell(2400, 14000), a: cell(3397, 33244), b: cell(3700, 14000), c: cell(2400, 8000) }, 'ref');
  assert.deepEqual(out.map((o) => `${o.arm}:${o.measure}`), ['a:artifactBytes', 'b:finalChars', 'c:artifactBytes']);
  near(out[1].ratio, 3700 / 2400);
  near(out[2].ratio, 8000 / 14000);
  assert.equal(L.describeOutliers(out.slice(0, 1), 'ref'), 'a artifact bytes 33244 vs ref 14000 (2.37x)');
});

test('lengthOutliers: absent data is skipped, not flagged', () => {
  const none = { length: { finalChars: { n: 0, mean: null }, artifactBytes: { n: 0, mean: null } } };
  assert.deepEqual(L.lengthOutliers({ ref: cell(0, 0), a: cell(5000, 5000) }, 'ref'), []);
  assert.deepEqual(L.lengthOutliers({ ref: none, a: cell(5000, 5000) }, 'ref'), []);
  assert.deepEqual(L.lengthOutliers({ ref: cell(1000, 1000), a: none }, 'ref'), []);
  assert.deepEqual(L.lengthOutliers({ ref: cell(1000, 1000), a: {} }, 'ref'), []);
  assert.deepEqual(L.lengthOutliers({ a: cell(5000, 5000) }, 'ref'), []);
});

test('artifactBytesOf counts created and changed files at full size, and leaves out seed files, tool state and the answer key', () => {
  const root = tmp();
  try {
    const fixture = path.join(root, 'fx');
    const run = path.join(root, 'run');
    write(path.join(fixture, 'seed.txt'), 'same');
    write(path.join(fixture, 'edit.txt'), 'old');
    write(path.join(run, 'workspace', 'seed.txt'), 'same');
    write(path.join(run, 'workspace', 'edit.txt'), 'new content');
    write(path.join(run, 'workspace', 'docs', 'made.md'), 'abcde');
    write(path.join(run, 'workspace', 'node_modules', 'x.js'), 'ignored ignored');
    write(path.join(run, 'workspace', '.git', 'HEAD'), 'ignored');
    assert.equal(L.artifactBytesOf(run, fixture), 'new content'.length + 'abcde'.length);
    assert.equal(L.artifactBytesOf(path.join(root, 'nowhere'), fixture), null);
    assert.equal(L.artifactBytesOf(run, path.join(root, 'no-fixture')), null);
    assert.equal(L.artifactBytesOf(run, null), null);
  } finally { rm(root); }
});

const JUDGED_SCORES = { vanilla: { 1: 0.1, 2: 0.2, 3: 0.3 }, v1: { 1: 0.6, 2: 0.5, 3: 0.4 } };
const sized = (arm, rep, bytes, finalChars) => ({ arm, rep, files: { 'out.md': 'x'.repeat(bytes) }, finalChars });
const RUNS = [sized('vanilla', 1, 100, 100), sized('vanilla', 2, 200, 100), sized('vanilla', 3, 300, 100), sized('v1', 1, 400, 100), sized('v1', 2, 500, 100), sized('v1', 3, 600, 100)];

// makeRun puts finalText only in the stream; result.json gets it here, as a real run's result does.
function build(root, name, { stamp = STAMP, runs = RUNS, scores = JUDGED_SCORES } = {}) {
  const s = buildStudy(root, name, { stamp, runs: runs.map(({ finalChars, ...r }) => r), scores, notJudged: [] });
  for (const r of runs) {
    const file = path.join(s.dir, r.arm, 't1', String(r.rep), 'result.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (r.finalChars !== null) data.finalText = 'y'.repeat(r.finalChars);
    fs.writeFileSync(file, JSON.stringify(data));
  }
  return s;
}

function report(s) {
  const r = buildReport({ run: loadRun(s.dir), tasks: loadTasks(s.bench), baseline: 'vanilla' });
  return { ...r, md: renderMarkdown(r.report) };
}

test('stamped: each arm and scope carries mean final-text characters and mean artifact bytes, and the tables show them with labels', () => {
  const root = tmp();
  try {
    const s = build(root, 'head');
    const r = report(s);
    for (const scope of ['overall', 'simple']) {
      assert.deepEqual(r.report.arms.vanilla[scope].length, { finalChars: { n: 3, mean: 100 }, artifactBytes: { n: 3, mean: 200 } });
      assert.deepEqual(r.report.arms.v1[scope].length, { finalChars: { n: 3, mean: 100 }, artifactBytes: { n: 3, mean: 500 } });
    }
    assert.match(r.md, /\| mean final text, characters \| mean artifact size, bytes of files created or changed \|/);
    assert.match(r.md, /\| v1 \| 3 \|.*\| 100 \(n=3\) \| 500 \(n=3\) \|/);
    assert.match(r.md, /\| vanilla \| 3 \|.*\| 100 \(n=3\) \| 200 \(n=3\) \|/);
    assert.match(r.md, /Output length: final text is counted in characters from result\.json/);
  } finally { rm(root); }
});

test('stamped: an arm more than 1.5x the baseline arm on artifact bytes gets a diligence WARN naming both numbers', () => {
  const root = tmp();
  try {
    const s = build(root, 'head');
    const { card } = analyze({ run: loadRun(s.dir), tasks: loadTasks(s.bench), baseline: 'vanilla' });
    const row = card.criteria.find((c) => c.id === 'length');
    assert.equal(row.status, 'WARN');
    assert.equal(row.key, false);
    assert.equal(row.value, 'v1 artifact bytes 500 vs vanilla 200 (2.50x)');
  } finally { rm(root); }
});

test('stamped: no warning when the arms are within 1.5x, and no row at all', () => {
  const root = tmp();
  try {
    const runs = RUNS.map((r) => (r.arm === 'v1' ? { ...r, files: { 'out.md': 'x'.repeat(300) } } : r));
    const s = build(root, 'head', { runs });
    const { card } = analyze({ run: loadRun(s.dir), tasks: loadTasks(s.bench), baseline: 'vanilla' });
    assert.equal(card.criteria.some((c) => c.id === 'length'), false);
  } finally { rm(root); }
});

test('stamped: runs that recorded no length give n/a and no warning', () => {
  const root = tmp();
  try {
    const s = build(root, 'head', { runs: RUNS.map((r) => ({ ...r, finalChars: null })) });
    for (const r of RUNS) rm(path.join(s.dir, r.arm, 't1', String(r.rep), 'workspace'));
    const r = report(s);
    const c = r.report.arms.v1.overall;
    assert.deepEqual(c.length, { finalChars: { n: 0, mean: null }, artifactBytes: { n: 0, mean: null } });
    assert.match(r.md, /\| n\/a \| n\/a \|/);
    const { card } = analyze({ run: loadRun(s.dir), tasks: loadTasks(s.bench), baseline: 'vanilla' });
    assert.equal(card.criteria.some((c2) => c2.id === 'length'), false);
  } finally { rm(root); }
});

test('unstamped: the report carries no length figures, columns or warning', () => {
  const root = tmp();
  try {
    const s = build(root, 'head', { stamp: null });
    const r = report(s);
    assert.ok(!JSON.stringify(r.report).includes('"length"'));
    assert.ok(!r.md.includes('artifact size'));
    assert.ok(!r.md.includes('Output length'));
    assert.equal(r.series.v1.overall.lengthPoints, undefined);
    const { card } = analyze({ run: loadRun(s.dir), tasks: loadTasks(s.bench), baseline: 'vanilla' });
    assert.equal(card.criteria.some((c) => c.id === 'length'), false);
    const c = contrastRun({ run: loadRun(s.dir), tasks: loadTasks(s.bench), base: 'vanilla' });
    assert.ok(!renderContrast(c).includes('Output length'));
  } finally { rm(root); }
});

test('stamped contrast: the within-task rank correlation of artifact bytes and rubric score is shown with n', () => {
  const root = tmp();
  try {
    const s = build(root, 'head');
    const c = contrastRun({ run: loadRun(s.dir), tasks: loadTasks(s.bench), base: 'vanilla' });
    // x ranks 1..6, y ranks 1,2,3,6,5,4: squared differences 0,0,0,4,0,4, so rho = 1 - 6*8/(6*35) = 0.77
    assert.match(c.cells.v1.overall.lengthCorrelation, /, 0\.77 over 6 run\(s\)\./);
    assert.match(renderContrast(c), /Output length: Spearman rank correlation between artifact bytes and rubric score, ranked within each task, 0\.77 over 6 run\(s\)/);
  } finally { rm(root); }
});

test('stamped contrast: fewer than six runs with both numbers leaves the line out', () => {
  const root = tmp();
  try {
    const s = build(root, 'head', { runs: RUNS.slice(0, 5), scores: { vanilla: JUDGED_SCORES.vanilla, v1: { 1: 0.6, 2: 0.5 } } });
    const c = contrastRun({ run: loadRun(s.dir), tasks: loadTasks(s.bench), base: 'vanilla' });
    assert.equal(c.cells.v1.overall.lengthCorrelation, undefined);
    assert.ok(!renderContrast(c).includes('Output length'));
  } finally { rm(root); }
});

test('stamped compare: the line counts the runs of both studies; an unstamped pair has none', () => {
  const root = tmp();
  try {
    const a = build(root, 'base');
    const b = build(root, 'head');
    const out = formatCompare(compareRuns({ baseDir: a.dir, headDir: b.dir, benchDir: b.bench }));
    assert.match(out, /Output length: Spearman rank correlation between artifact bytes and rubric score, ranked within each task, [-0-9.]+ over 12 run\(s\)/);
    const c = build(root, 'plain-base', { stamp: null });
    const d = build(root, 'plain-head', { stamp: null });
    assert.ok(!formatCompare(compareRuns({ baseDir: c.dir, headDir: d.dir, benchDir: d.bench })).includes('Output length'));
  } finally { rm(root); }
});
