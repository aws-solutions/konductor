// SPDX-License-Identifier: Apache-2.0
'use strict';

// contrast: one arm against a base arm, overall and per task class, on synthetic result.json sets.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun, addTask, writeJudgments } = require('./helpers.js');
const { contrastRun, renderContrast, pickBase } = require('../../report/contrast.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { main } = require('../bench.js');

const FAIL = [{ type: 'file_exists', path: 'a.txt', passed: false }];
const reps = (arm, n, f, task = 't1') => Array.from({ length: n }, (_, i) => ({ arm, task, rep: i + 1, ...f(i + 1) }));

function setup(specs, { cfg, tasks = { t2: 'review' } } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  for (const [id, cls] of Object.entries(tasks)) addTask(bench, id, cls);
  const runDir = makeRun(path.join(root, 'run'), bench, specs, cfg);
  return { root, bench, runDir, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const analyze = (s, o = {}) => contrastRun({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), ...o });
const cellOf = (c, head, scope) => c.cells[head][scope];
const metric = (cell, name) => cell.metrics[name];

test('default base is v1.2.0 when present, else vanilla, else the first arm; default head is every other arm', () => {
  assert.equal(pickBase(['vanilla', 'v1.2.0', 'pr']), 'v1.2.0');
  assert.equal(pickBase(['pr', 'vanilla', 'main']), 'vanilla');
  assert.equal(pickBase(['pr', 'main']), 'pr');
  const s = setup([...reps('v1.2.0', 3, () => ({})), ...reps('vanilla', 3, () => ({})), ...reps('pr', 3, () => ({}))]);
  try {
    const c = analyze(s);
    assert.equal(c.base, 'v1.2.0');
    assert.deepEqual(c.heads, ['vanilla', 'pr']);
    assert.deepEqual(analyze(s, { base: 'vanilla', heads: ['pr'] }).heads, ['pr']);
  } finally { s.done(); }
});

test('an unknown base or head arm is an error that lists the arms present', () => {
  const s = setup(reps('a', 3, () => ({})));
  try {
    assert.throws(() => analyze(s, { base: 'nope' }), /base arm "nope" has no runs.*a/);
    assert.throws(() => analyze(s, { base: 'a', heads: ['zz'] }), /head arm "zz" has no runs/);
  } finally { s.done(); }
});

test('metrics, absolute and relative deltas and verdicts: worse beyond noise, improved, within noise', () => {
  const s = setup([
    ...reps('base', 4, (i) => ({ credits: 10 + i * 0.1, wallClockMs: 100000, modelCalls: { meteringEntries: 20 }, workToolCalls: 10, subagentCalls: 0 })),
    ...reps('pr', 4, (i) => ({ credits: 20 + i * 0.1, wallClockMs: 100500, modelCalls: { meteringEntries: 10 }, workToolCalls: 10, subagentCalls: 3 })),
  ], { tasks: {} });
  try {
    const cell = cellOf(analyze(s, { base: 'base' }), 'pr', 'overall');
    const credits = metric(cell, 'cost');
    assert.equal(credits.unit, 'credits');
    assert.ok(Math.abs(credits.base - 10.25) < 1e-9);
    assert.ok(Math.abs(credits.head - 20.25) < 1e-9);
    assert.ok(Math.abs(credits.abs - 10) < 1e-9);
    assert.ok(Math.abs(credits.rel - 10 / 10.25) < 1e-9);
    assert.equal(credits.nBase, 4);
    assert.equal(credits.verdict, 'worse');
    assert.equal(metric(cell, 'modelCalls').verdict, 'improved');
    assert.equal(metric(cell, 'wallClockMs').verdict, 'within noise');
    assert.equal(metric(cell, 'subagentCalls').verdict, 'worse');
    assert.equal(metric(cell, 'workToolCalls').verdict, 'within noise');
    assert.equal(metric(cell, 'workToolCalls').abs, 0);
  } finally { s.done(); }
});

test('n below 3 on either side gives the verdict "n too small", shows the raw delta, and prints an anecdotal line', () => {
  const s = setup([
    ...reps('base', 3, () => ({ credits: 5 })), ...reps('pr', 3, () => ({ credits: 9 })),
    ...reps('base', 1, () => ({ credits: 5 }), 't2'), ...reps('pr', 1, () => ({ credits: 9 }), 't2'),
  ]);
  try {
    const c = analyze(s, { base: 'base' });
    const review = cellOf(c, 'pr', 'review');
    assert.equal(metric(review, 'cost').verdict, 'n too small');
    assert.equal(metric(review, 'cost').abs, 4);
    assert.equal(metric(review, 'cost').nBase, 1);
    assert.ok(c.anecdotal.some((a) => a.scope === 'review' && a.head === 'pr' && a.n === 1));
    assert.equal(metric(cellOf(c, 'pr', 'overall'), 'cost').verdict, 'worse');
    const md = renderContrast(c);
    assert.match(md, /anecdotal/i);
    assert.match(md, /review.*n=1|n=1.*review/s);
  } finally { s.done(); }
});

test('failed runs are never hidden: outcomes are counted and shown, and a timeout is charged and included in the medians', () => {
  const s = setup([
    ...reps('base', 4, () => ({ credits: 4 })),
    { arm: 'pr', rep: 1, credits: 4 },
    { arm: 'pr', rep: 2, credits: 4, checks: FAIL },
    { arm: 'pr', rep: 3, status: 'timeout', credits: null, creditsCensored: true, creditsLowerBound: 1, creditsCharged: 6, wallClockMs: 900000 },
    { arm: 'pr', rep: 4, status: 'error', credits: 2, error: 'boom' },
    { arm: 'pr', rep: 5, credits: 4, flags: ['modelMismatch'] },
    { arm: 'pr', rep: 6, credits: 4, infraError: 'workspace snapshot failed' },
  ], { tasks: {} });
  try {
    const c = analyze(s, { base: 'base' });
    const cell = cellOf(c, 'pr', 'overall');
    assert.deepEqual(cell.outcomes.head, { n: 6, good: 1, checksFailed: 1, timeout: 1, error: 1, infraError: 1, modelMismatch: 1, skipped: 0 });
    assert.equal(cell.outcomes.base.good, 4);
    assert.equal(metric(cell, 'timeouts').head, 1 / 6);
    assert.equal(metric(cell, 'modelMismatch').head, 1 / 6);
    const credits = metric(cell, 'cost');
    assert.equal(credits.nHead, 6, 'every executed run feeds the median, charged value for the timeout');
    assert.ok(cell.notes.some((n) => /timeout|not clean/.test(n)));
    const md = renderContrast(c);
    assert.match(md, /timeout/);
    assert.match(md, /1 of 6|1\/6/);
  } finally { s.done(); }
});

test('budget-skipped runs are left out of n and counted as skipped', () => {
  const s = setup([...reps('base', 3, () => ({})), ...reps('pr', 3, () => ({})), { arm: 'pr', rep: 4, status: 'budget_skipped', credits: null }], { tasks: {} });
  try {
    const cell = cellOf(analyze(s, { base: 'base' }), 'pr', 'overall');
    assert.equal(cell.outcomes.head.n, 3);
    assert.equal(cell.outcomes.head.skipped, 1);
  } finally { s.done(); }
});

test('hidden tests: pass fraction from runs that have a score, unscored runs counted, no data when the task has none', () => {
  const h = (passed, total) => ({ hiddenTests: { passed, total } });
  const s = setup([
    ...reps('base', 3, () => h(5, 10)),
    { arm: 'pr', rep: 1, ...h(10, 10) }, { arm: 'pr', rep: 2, ...h(9, 10) }, { arm: 'pr', rep: 3, ...h(10, 10) },
    { arm: 'pr', rep: 4, status: 'timeout', hiddenTests: null },
    ...reps('base', 3, () => ({}), 't2'), ...reps('pr', 3, () => ({}), 't2'),
  ]);
  try {
    const c = analyze(s, { base: 'base' });
    const hidden = metric(cellOf(c, 'pr', 'overall'), 'hiddenFraction');
    assert.equal(hidden.nBase, 3);
    assert.equal(hidden.nHead, 3);
    assert.ok(Math.abs(hidden.head - 29 / 30) < 1e-9);
    assert.equal(hidden.base, 0.5);
    assert.equal(hidden.unscoredHead, 1);
    assert.equal(hidden.verdict, 'improved');
    const none = metric(cellOf(c, 'pr', 'review'), 'hiddenFraction');
    assert.equal(none.verdict, 'no data');
    assert.equal(none.nHead, 0);
    assert.match(renderContrast(c), /no data/);
  } finally { s.done(); }
});

test('real tasks: FAIL_TO_PASS is the hidden figure and PASS_TO_PASS is the regression figure', () => {
  const s = setup([
    ...reps('base', 3, () => ({ hiddenTests: { passed: 1, total: 2 }, regressionTests: { passed: 10, total: 10 } })),
    ...reps('pr', 3, () => ({ hiddenTests: { passed: 2, total: 2 }, regressionTests: { passed: 8, total: 10 } })),
  ], { tasks: {} });
  try {
    const cell = cellOf(analyze(s, { base: 'base' }), 'pr', 'overall');
    assert.equal(metric(cell, 'hiddenFraction').head, 1);
    assert.ok(Math.abs(metric(cell, 'regressionFraction').head - 0.8) < 1e-9);
    assert.equal(metric(cell, 'regressionFraction').verdict, 'worse');
  } finally { s.done(); }
});

test('checks pass share, flags (askedUser, externalFetch, fixRecall) and rubric score when judged', () => {
  const s = setup([
    ...reps('base', 3, () => ({ askedUser: true, contamination: { externalFetch: ['https://x'], fixRecallChars: 500 } })),
    ...reps('pr', 3, (i) => ({ askedUser: false, ...(i === 1 ? { checks: FAIL } : {}), contamination: { externalFetch: [], fixRecallChars: 0 } })),
  ], { tasks: {} });
  writeJudgments(s.runDir, {
    judges: ['j1'],
    rubric: [1, 2, 3].flatMap((rep) => [{ judge: 'j1', arm: 'base', rep, score: 0.4 }, { judge: 'j1', arm: 'pr', rep, score: 0.9 }]),
  });
  try {
    const cell = cellOf(analyze(s, { base: 'base' }), 'pr', 'overall');
    assert.ok(Math.abs(metric(cell, 'checksPass').head - 2 / 3) < 1e-9);
    assert.equal(metric(cell, 'checksPass').base, 1);
    assert.equal(metric(cell, 'askedUser').base, 1);
    assert.equal(metric(cell, 'askedUser').head, 0);
    assert.equal(metric(cell, 'askedUser').verdict, 'improved');
    assert.equal(metric(cell, 'externalFetch').base, 1);
    assert.equal(metric(cell, 'fixRecall').base, 1);
    assert.equal(metric(cell, 'fixRecall').head, 0);
    assert.equal(metric(cell, 'rubric').verdict, 'improved');
    assert.ok(Math.abs(metric(cell, 'rubric').head - 0.9) < 1e-9);
  } finally { s.done(); }
});

test('rubric is "no data" when the run was not judged', () => {
  const s = setup([...reps('base', 3, () => ({})), ...reps('pr', 3, () => ({}))], { tasks: {} });
  try {
    assert.equal(metric(cellOf(analyze(s, { base: 'base' }), 'pr', 'overall'), 'rubric').verdict, 'no data');
  } finally { s.done(); }
});

test('arm provenance (ref, sha, source, dirty, ahead, files) is carried into the report', () => {
  const sha = 'c'.repeat(40);
  const s = setup([
    ...reps('base', 3, () => ({ commitSha: 'a'.repeat(40), source: 'git' })),
    ...reps('pr', 3, () => ({ ref: 'origin/feat/x', commitSha: sha, source: 'git', dirty: false, commitsAhead: 4, filesChanged: { count: 7, topLevel: ['skills', 'agents'] } })),
  ], { tasks: {} });
  try {
    const c = analyze(s, { base: 'base' });
    assert.equal(c.arms.pr.commitSha, sha);
    assert.equal(c.arms.pr.commitsAhead, 4);
    const md = renderContrast(c);
    assert.ok(md.includes(sha.slice(0, 10)));
    assert.match(md, /4 ahead/);
    assert.match(md, /skills, agents/);
  } finally { s.done(); }
});

test('the CLI writes contrast.md and contrast.json into the run directory and prints the markdown', async () => {
  const s = setup([...reps('v1.2.0', 3, () => ({ credits: 3 })), ...reps('pr', 3, () => ({ credits: 3 }))], { tasks: {} });
  const lines = [];
  const orig = console.log;
  console.log = (m) => lines.push(String(m));
  try {
    await main(['contrast', '--run', s.runDir]);
  } finally { console.log = orig; }
  try {
    const md = fs.readFileSync(path.join(s.runDir, 'contrast.md'), 'utf8');
    const json = JSON.parse(fs.readFileSync(path.join(s.runDir, 'contrast.json'), 'utf8'));
    assert.equal(json.base, 'v1.2.0');
    assert.deepEqual(json.heads, ['pr']);
    assert.ok(lines.join('\n').includes('pr vs v1.2.0'));
    assert.ok(md.includes('pr vs v1.2.0'));
  } finally { s.done(); }
});
