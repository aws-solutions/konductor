// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Autonomy section of the report, the new contrast rows and the compare metrics.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../lib/tasks.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');
const { contrastRun, renderContrast, SPECS } = require('../../report/contrast.js');
const { compareRuns, METRICS } = require('../../report/compare.js');

const AUTONOMY = { clarifications: [{ id: 'unit', topic: 'unit', keywords: ['unit'], answer: 'Seconds.' }] };
const frac = (passed, total) => ({ passed, total, unparsed: false });
// One autonomy run: i is the 1-based replicate.
const auto = (arm, task, rep, o = {}) => ({
  arm, task, rep, turns: 1, interjections: 0, questions: [], questionsAsked: 0, unmatchedQuestions: 0, askedFirstTurn: false, interjectionCapHit: false,
  autonomous: true, intendedTests: frac(4, 4), invariantTests: frac(2, 2), completedWithoutHelp: true, assumptionsStated: true,
  credits: 2, creditsCharged: 2, wallClockMs: 60000, checks: [{ type: 'tests', passed: true, group: 'intended', tests: frac(4, 4) }], ...o,
});

function setup(specs, { cfg } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const t1 = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t1, class: 'autonomy', tiers: ['autonomy'], autonomy: AUTONOMY }));
  write(path.join(bench, 'tasks/t2.json'), JSON.stringify({ ...t1, id: 't2', class: 'autonomy', tiers: ['autonomy'], autonomy: { clarifications: [], noQuestionNeeded: true } }));
  const runDir = makeRun(path.join(root, 'run'), bench, specs, { suite: 'autonomy', taskIds: ['t1', 't2'], ...cfg });
  return { root, bench, runDir, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const Q = (turn, matched = ['unit']) => ({ turn, text: 'Which unit?', matched, answered: true, reply: 'Seconds.' });

// vanilla: needs help on t1 twice; asks once on the no-question task t2. v: never asks.
const SPECS_RUN = [
  auto('vanilla', 't1', 1, { turns: 2, interjections: 1, questionsAsked: 1, questions: [Q(1)], askedFirstTurn: true, autonomous: false, completedWithoutHelp: false, credits: 4, creditsCharged: 4, wallClockMs: 120000 }),
  auto('vanilla', 't1', 2, { turns: 3, interjections: 2, questionsAsked: 2, unmatchedQuestions: 1, questions: [Q(1), Q(2, [])], askedFirstTurn: true, autonomous: false, completedWithoutHelp: false, intendedTests: frac(2, 4), credits: 6, creditsCharged: 6, wallClockMs: 180000, checks: [{ type: 'tests', passed: false, group: 'intended', tests: frac(2, 4) }] }),
  auto('vanilla', 't1', 3, {}),
  auto('vanilla', 't2', 1, { turns: 2, interjections: 1, questionsAsked: 1, unmatchedQuestions: 1, questions: [Q(1, [])], askedFirstTurn: true, autonomous: false, completedWithoutHelp: false, credits: 3, creditsCharged: 3 }),
  auto('vanilla', 't2', 2, {}),
  auto('vanilla', 't2', 3, { interjectionCapHit: true, interjections: 4, turns: 6, autonomous: false, completedWithoutHelp: false, questionsAsked: 5, unmatchedQuestions: 4, askedFirstTurn: true }),
  auto('main', 't1', 1, {}),
  auto('main', 't1', 2, {}),
  auto('main', 't1', 3, {}),
];

test('Autonomy section per arm: asked rate, interjections, unnecessary questions, cap hits, tests, help-free rate and cost', () => {
  const s = setup(SPECS_RUN);
  try {
    const { report } = buildReport({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), baseline: 'vanilla' });
    const a = report.arms.vanilla.autonomy.autonomy;
    assert.equal(a.runs, 6);
    assert.equal(a.askedRuns, 4);
    assert.equal(a.askedRate, 4 / 6);
    assert.equal(a.askedFirstTurnRate, 4 / 6);
    assert.equal(a.meanInterjections, (1 + 2 + 0 + 1 + 0 + 4) / 6);
    assert.deepEqual(a.noQuestionTasks, { runs: 3, askedRuns: 2, questions: 6 });
    assert.equal(a.unmatchedQuestions, 1, 'unmatched questions are counted on the tasks that have clarifications; the no-question task is shown apart');
    assert.equal(a.capHits, 1);
    assert.equal(a.intended.runs, 6);
    assert.equal(a.intended.meanFraction, (1 + 0.5 + 1 + 1 + 1 + 1) / 6);
    assert.equal(a.intended.allPassShare, 5 / 6);
    assert.equal(a.invariants.allPassShare, 1);
    assert.equal(a.completedWithoutHelpRate, 2 / 6);
    assert.equal(a.interjectionsPerSuccess, 8 / 5, '8 interjections over the 5 runs whose checks all passed');
    assert.equal(a.costPerRun, (4 + 6 + 2 + 3 + 2 + 2) / 6, 'cost covers every turn of every executed run');
    assert.equal(a.wallClockPerRunMs, (120000 + 180000 + 60000 * 4) / 6);
    const m = report.arms.main.autonomy.autonomy;
    assert.equal(m.askedRate, 0);
    assert.equal(m.completedWithoutHelpRate, 1);
    assert.equal(m.interjectionsPerSuccess, 0);
  } finally { s.done(); }
});

test('markdown report has an Autonomy section with one row per arm and the unnecessary questions shown separately', () => {
  const s = setup(SPECS_RUN);
  try {
    const { report } = buildReport({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), baseline: 'vanilla' });
    const md = renderMarkdown(report);
    const i = md.indexOf('## Autonomy');
    assert.ok(i > md.indexOf('## Results'));
    const section = md.slice(i);
    assert.match(section, /\| vanilla \|/);
    assert.match(section, /\| main \|/);
    assert.match(section, /questions on no-question tasks/);
    assert.match(section, /unmatched questions/);
    assert.match(section, /completed without help/);
    assert.match(section, /interjections per successful run/);
    assert.match(section, /heuristic/);
  } finally { s.done(); }
});

test('a run set without autonomy data has no Autonomy section and no autonomy cell', () => {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', rep: 1 }, { arm: 'vanilla', rep: 2 }]);
  try {
    const { report } = buildReport({ run: loadRun(runDir), tasks: loadTasks(bench), baseline: 'vanilla' });
    assert.equal('autonomy' in report.arms.vanilla.overall, false);
    assert.doesNotMatch(renderMarkdown(report), /## Autonomy/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const metricOf = (c, head, scope, name) => c.cells[head][scope].metrics[name];

test('contrast has the five autonomy metrics with the right direction and verdicts under the shared noise rules', () => {
  const specs = [
    ...[1, 2, 3].map((i) => auto('base', 't1', i, { interjections: 2, unmatchedQuestions: 1, intendedTests: frac(2, 4), invariantTests: frac(2, 2), completedWithoutHelp: false })),
    ...[1, 2, 3].map((i) => auto('head', 't1', i, { interjections: 0, unmatchedQuestions: 0, intendedTests: frac(4, 4), invariantTests: frac(1, 2), completedWithoutHelp: true })),
  ];
  const s = setup(specs);
  try {
    const c = contrastRun({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), base: 'base' });
    const get = (n) => metricOf(c, 'head', 'overall', n);
    assert.equal(get('interjections').verdict, 'improved');
    assert.equal(get('interjections').base, 2);
    assert.equal(get('interjections').head, 0);
    assert.equal(get('unmatchedQuestions').verdict, 'improved');
    assert.equal(get('intendedFraction').verdict, 'improved');
    assert.equal(get('intendedFraction').head, 1);
    assert.equal(get('invariantFraction').verdict, 'worse');
    assert.equal(get('completedWithoutHelp').verdict, 'improved');
    assert.equal(get('completedWithoutHelp').head, 1);
    const names = Object.fromEntries(SPECS.map((x) => [x.name, x.better]));
    assert.equal(names.interjections, 'lower');
    assert.equal(names.unmatchedQuestions, 'lower');
    assert.equal(names.intendedFraction, 'higher');
    assert.equal(names.invariantFraction, 'higher');
    assert.equal(names.completedWithoutHelp, 'higher');
    const md = renderContrast(c);
    assert.match(md, /\| interjections \|/);
    assert.match(md, /\| intended tests passed \|/);
    assert.match(md, /\| completed without help \|/);
  } finally { s.done(); }
});

test('with fewer than three runs a side the autonomy rows say n too small', () => {
  const s = setup([auto('base', 't1', 1, { interjections: 2 }), auto('head', 't1', 1, { interjections: 0 })]);
  try {
    const c = contrastRun({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), base: 'base' });
    assert.equal(metricOf(c, 'head', 'overall', 'interjections').verdict, 'n too small');
  } finally { s.done(); }
});

test('contrast output for runs without autonomy data has no autonomy rows', () => {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, [1, 2, 3].flatMap((rep) => [{ arm: 'base', rep }, { arm: 'head', rep }]));
  try {
    const c = contrastRun({ run: loadRun(runDir), tasks: loadTasks(bench), base: 'base' });
    const md = renderContrast(c);
    assert.doesNotMatch(md, /interjections|intended tests|completed without help|unmatched questions/);
    assert.match(md, /\| cost \(credits\) \|/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('compare reports a rise in interjections as a regression and a rise in intended tests as an improvement', () => {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const t1 = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t1, class: 'autonomy', tiers: ['autonomy'], autonomy: AUTONOMY }));
  const baseSpecs = [1, 2, 3].map((i) => auto('a', 't1', i, { interjections: 0, intendedTests: frac(2, 4) }));
  const headSpecs = [1, 2, 3].map((i) => auto('a', 't1', i, { interjections: 3, intendedTests: frac(4, 4) }));
  const base = makeRun(path.join(root, 'base'), bench, baseSpecs, { suite: 'autonomy' });
  const head = makeRun(path.join(root, 'head'), bench, headSpecs, { suite: 'autonomy' });
  try {
    const r = compareRuns({ baseDir: base, headDir: head, benchDir: bench });
    assert.ok(r.regressions.some((x) => x.metric === 'interjections' && x.direction === 'worse'));
    assert.ok(r.improvements.some((x) => x.metric === 'intendedFraction'));
    assert.equal(r.exitCode, 1);
    const better = { interjections: 'lower', unmatchedQuestions: 'lower', intendedFraction: 'higher', invariantFraction: 'higher', completedWithoutHelp: 'higher' };
    for (const [name, dir] of Object.entries(better)) assert.equal(METRICS.find((m) => m.name === name)?.better, dir, name);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('compare of runs without autonomy data has no autonomy findings', () => {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const specs = [1, 2, 3].map((rep) => ({ arm: 'a', rep, credits: 1 }));
  const base = makeRun(path.join(root, 'base'), bench, specs);
  const head = makeRun(path.join(root, 'head'), bench, specs);
  try {
    const r = compareRuns({ baseDir: base, headDir: head, benchDir: bench });
    assert.deepEqual([...r.regressions, ...r.improvements], []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
