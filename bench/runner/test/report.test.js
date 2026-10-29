// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun, addTask, writeJudgments } = require('./helpers.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../../runner/lib/tasks.js');
const { buildReport } = require('../../report/aggregate.js');
const { medianCI, median } = require('../../report/stats.js');
const { renderMarkdown } = require('../../report/render.js');

const FAIL = [{ type: 'file_exists', path: 'a.txt', passed: false }];
function build(specs, { config, judgments, extraTasks = [] } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  for (const [id, cls] of extraTasks) addTask(bench, id, cls);
  const runDir = makeRun(path.join(root, 'run'), bench, specs, config);
  if (judgments) writeJudgments(runDir, judgments);
  const rep = buildReport({ run: loadRun(runDir), tasks: loadTasks(bench), baseline: 'vanilla' });
  return { root, runDir, bench, ...rep };
}
const done = (root) => fs.rmSync(root, { recursive: true, force: true });

test('median and bootstrap CI of the median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  const ci = medianCI([1, 2, 3, 4, 5]);
  assert.equal(ci.median, 3);
  assert.ok(ci.ciLow >= 1 && ci.ciHigh <= 5 && ci.ciLow <= 3 && ci.ciHigh >= 3);
  assert.deepEqual(medianCI([1, 2, 3, 4, 5]), ci, 'seeded, so repeatable');
  assert.deepEqual(medianCI([7]), { n: 1, median: 7, ciLow: 7, ciHigh: 7 });
  assert.equal(medianCI([]).median, null);
});

test('rates, medians and credits per successful run', () => {
  const r = build([
    { arm: 'vanilla', rep: 1, credits: 1 }, { arm: 'vanilla', rep: 2, credits: 2 },
    { arm: 'vanilla', rep: 3, credits: 3, checks: FAIL },
    { arm: 'k', rep: 1, credits: 3 }, { arm: 'k', rep: 2, credits: 3 }, { arm: 'k', rep: 3, credits: 3 },
  ]);
  try {
    const v = r.report.arms.vanilla.overall;
    assert.equal(v.n, 3);
    assert.equal(v.successRate, 1);
    assert.equal(v.checkPassRate, 2 / 3);
    assert.equal(v.efficiency.credits.median, 1.5, 'the run whose checks failed is not in the median');
    assert.equal(v.credits.total, 6);
    assert.equal(v.credits.perSuccessfulRun, 3);
    assert.equal(r.report.arms.k.overall.credits.perSuccessfulRun, 3);
    assert.equal(v.lowReplicates, false);
  } finally { done(r.root); }
});

test('an arm that fails fast does not look cheap: no successes means null, not zero', () => {
  const r = build([
    { arm: 'fast', rep: 1, credits: 0.1, checks: FAIL }, { arm: 'fast', rep: 2, credits: 0.1, checks: FAIL },
    { arm: 'fast', rep: 3, credits: 0.1, checks: FAIL },
    { arm: 'half', rep: 1, credits: 0.5, checks: FAIL }, { arm: 'half', rep: 2, credits: 0.5, checks: FAIL },
    { arm: 'half', rep: 3, credits: 0.5 },
  ]);
  try {
    assert.equal(r.report.arms.fast.overall.credits.perSuccessfulRun, null);
    assert.ok(Math.abs(r.report.arms.half.overall.credits.perSuccessfulRun - 1.5) < 1e-9);
  } finally { done(r.root); }
});

test('timeouts and errors stay in the rates; missing credits are counted, skipped runs are separate', () => {
  const r = build([
    { arm: 'a', rep: 1, credits: 2 },
    { arm: 'a', rep: 2, status: 'timeout', credits: null, runFinishedStatus: null, checks: FAIL },
    { arm: 'a', rep: 3, status: 'error', credits: 1, checks: FAIL },
    { arm: 'a', rep: 4, status: 'budget_skipped', credits: null, checks: [], wallClockMs: null },
  ]);
  try {
    const c = r.report.arms.a.overall;
    assert.equal(c.n, 3);
    assert.equal(c.skipped, 1);
    assert.deepEqual(c.byStatus, { success: 1, timeout: 1, error: 1 });
    assert.equal(c.successRate, 1 / 3);
    assert.equal(c.checkPassRate, 1 / 3);
    assert.equal(c.credits.missing, 1);
    assert.equal(c.credits.total, 3);
    assert.equal(c.efficiency.credits.n, 1, 'only the clean pass is in the medians');
  } finally { done(r.root); }
});

test('fewer than 3 replicates per task flags the cell', () => {
  const r = build([{ arm: 'a', rep: 1 }, { arm: 'a', rep: 2 }, { arm: 'b', rep: 1 }, { arm: 'b', rep: 2 }, { arm: 'b', rep: 3 }]);
  try {
    assert.equal(r.report.arms.a.overall.lowReplicates, true);
    assert.match(r.report.arms.a.overall.flags.join(' '), /fewer than 3 replicates/);
    assert.equal(r.report.arms.b.overall.lowReplicates, false);
  } finally { done(r.root); }
});

test('cells are split by task class and overall', () => {
  const r = build([
    { arm: 'a', task: 't1', credits: 1 }, { arm: 'a', task: 't2', credits: 5 }, { arm: 'a', task: 't3', credits: 9 },
  ], { extraTasks: [['t2', 'sop'], ['t3', 'sop']] });
  try {
    assert.deepEqual(Object.keys(r.report.arms.a).sort(), ['overall', 'simple', 'sop']);
    assert.equal(r.report.arms.a.sop.n, 2);
    assert.equal(r.report.arms.a.sop.efficiency.credits.median, 7);
    assert.equal(r.report.arms.a.overall.n, 3);
  } finally { done(r.root); }
});

test('rubric means per judge and across judges, with a disagreement flag', () => {
  const r = build([{ arm: 'a', rep: 1 }, { arm: 'a', rep: 2 }, { arm: 'a', rep: 3 }], {
    judgments: {
      judges: ['j1', 'j2'],
      rubric: [1, 2, 3].flatMap((rep) => [{ judge: 'j1', arm: 'a', rep, score: 0.9 }, { judge: 'j2', arm: 'a', rep, score: 0.3 }])
        .concat([{ judge: 'j1', arm: 'a', rep: 4, error: 'x' }]),
    },
  });
  try {
    const c = r.report.arms.a.overall;
    assert.ok(Math.abs(c.rubric.byJudge.j1.mean - 0.9) < 1e-9);
    assert.ok(Math.abs(c.rubric.byJudge.j2.mean - 0.3) < 1e-9);
    assert.ok(Math.abs(c.rubric.meanOfJudges.mean - 0.6) < 1e-9);
    assert.ok(Math.abs(c.rubric.disagreement.meanAbsDiff - 0.6) < 1e-9);
    assert.match(c.flags.join(' '), /judges disagree/);
  } finally { done(r.root); }
});

test('pairwise tallies are per judge and pooled, and absent for the baseline arm', () => {
  const r = build([{ arm: 'vanilla', rep: 1 }, { arm: 'vanilla', rep: 2 }, { arm: 'k', rep: 1 }, { arm: 'k', rep: 2 }], {
    judgments: {
      judges: ['j1'],
      pairwise: [
        { judge: 'j1', arm: 'k', rep: 1, verdict: 'win' },
        { judge: 'j1', arm: 'k', rep: 2, verdict: 'tie', pi: true },
        { judge: 'j1', arm: 'k', rep: 3, verdict: null, error: 'bad' },
      ],
    },
  });
  try {
    assert.equal(r.report.arms.vanilla.overall.pairwise, null);
    const p = r.report.arms.k.overall.pairwise;
    assert.deepEqual(p.byJudge.j1, { win: 1, tie: 1, loss: 0, positionInconsistent: 1, errors: 1 });
    assert.deepEqual(p.total, p.byJudge.j1);
  } finally { done(r.root); }
});

test('markdown labels estimated tokens, shows flags, and report.json round-trips', () => {
  const r = build([{ arm: 'vanilla', rep: 1 }, { arm: 'k', rep: 1, status: 'timeout', credits: null, checks: FAIL }]);
  try {
    const md = renderMarkdown(r.report);
    assert.match(md, /estTokens \(estimate\)/);
    assert.match(md, /fewer than 3 replicates/);
    assert.match(md, /timeout/);
    assert.deepEqual(JSON.parse(JSON.stringify(r.report)), r.report);
  } finally { done(r.root); }
});

test('timeout rate, censored credits and asked-user rate appear next to every cost figure', () => {
  const r = build([
    { arm: 'k', rep: 1, credits: 2, askedUser: true, creditsCensored: false },
    { arm: 'k', rep: 2, credits: 0.4, status: 'timeout', creditsCensored: true, creditsLowerBound: 0.4, askedUser: null },
    { arm: 'k', rep: 3, credits: 2, askedUser: false, creditsCensored: false, flags: ['homeTripwire'] },
  ]);
  try {
    const c = r.report.arms.k.overall;
    assert.equal(c.timeoutRate, 1 / 3);
    assert.equal(c.askedUserRate, 1 / 2);
    assert.equal(c.credits.censoredRuns, 1);
    assert.equal(c.credits.isLowerBound, true);
    assert.deepEqual(c.flagCounts, { homeTripwire: 1 });
    assert.ok(c.flags.some((f) => /lower bounds/.test(f)));
    const md = renderMarkdown(r.report);
    assert.match(md, /timeout 33%, lower bound \(1 censored\)/);
    assert.match(md, /asked user/);
    assert.match(md, /flagged homeTripwire/);
  } finally { done(r.root); }
});

test('results written before the new fields existed still aggregate', () => {
  const r = build([{ arm: 'old', rep: 1, credits: 1 }]);
  try {
    const c = r.report.arms.old.overall;
    assert.equal(c.credits.censoredRuns, 0);
    assert.equal(c.askedUserRate, null);
    assert.match(renderMarkdown(r.report), /timeout 0%/);
  } finally { done(r.root); }
});
