// SPDX-License-Identifier: Apache-2.0
'use strict';

// Failed, censored and mismatched runs must not make an arm look cheaper or faster.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { loadRun } = require('../../report/load.js');
const { loadTasks } = require('../../runner/lib/tasks.js');
const { buildReport } = require('../../report/aggregate.js');
const { compareRuns } = require('../../report/compare.js');
const { renderMarkdown } = require('../../report/render.js');

const GOOD = (arm, rep) => ({ arm, rep, credits: 2, wallClockMs: 100000, toolCalls: 10 });
const goodRuns = (arm, from, count) => Array.from({ length: count }, (_, i) => GOOD(arm, from + i));

function cell(specs) {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, specs);
    const { report } = buildReport({ run: loadRun(runDir), tasks: loadTasks(bench), baseline: 'vanilla' });
    return { c: report.arms.a.overall, md: renderMarkdown(report) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('3 fast crashes do not lower the medians; they raise the cost per successful run', () => {
  const crashes = [3, 4, 5].map((rep) => ({ arm: 'a', rep, status: 'error', credits: 0.02, wallClockMs: 3000, toolCalls: 0, runFinishedStatus: null }));
  const { c } = cell([...goodRuns('a', 1, 2), ...crashes]);
  assert.equal(c.efficiency.credits.median, 2);
  assert.equal(c.efficiency.wallClockMs.median, 100000);
  assert.equal(c.efficiency.toolCalls.median, 10);
  assert.equal(c.efficiencyRuns, 2);
  assert.equal(c.rates.error, 3 / 5);
  assert.equal(c.successRate, 2 / 5);
  assert.ok(Math.abs(c.credits.perSuccessfulRun - (2 * 2 + 3 * 0.02) / 2) < 1e-9);
});

test('3 timeouts with passing checks are charged the ledger value and stay out of the medians', () => {
  const timeouts = (extra) => [3, 4, 5].map((rep) => ({ arm: 'a', rep, status: 'timeout', credits: 0.5, creditsCensored: true, creditsLowerBound: 0.5, wallClockMs: 600000, runFinishedStatus: null, ...extra }));
  const withLedger = cell([...goodRuns('a', 1, 2), ...timeouts({ creditsCharged: 2 })]);
  assert.equal(withLedger.c.efficiency.credits.median, 2);
  assert.equal(withLedger.c.efficiency.wallClockMs.median, 100000);
  assert.equal(withLedger.c.timeoutRate, 3 / 5);
  assert.equal(withLedger.c.checkPassRate, 2 / 5);
  assert.equal(withLedger.c.credits.perSuccessfulRun, (2 * 2 + 3 * 2) / 2);
  assert.match(withLedger.md, /timeout 60%, lower bound \(3 censored\)/);
  const withoutLedger = cell([...goodRuns('a', 1, 2), ...timeouts({})]);
  assert.equal(withoutLedger.c.credits.perSuccessfulRun, (2 * 2 + 3 * 0.5) / 2, 'falls back to the known lower bound, never 0');
});

test('3 model mismatches with passing checks are not successes', () => {
  const mismatches = [3, 4, 5].map((rep) => ({ arm: 'a', rep, status: 'error', flags: ['modelMismatch'], credits: 0.1, wallClockMs: 5000 }));
  const { c, md } = cell([...goodRuns('a', 1, 2), ...mismatches]);
  assert.equal(c.successRate, 2 / 5);
  assert.equal(c.checkPassRate, 2 / 5);
  assert.equal(c.rates.modelMismatch, 3 / 5);
  assert.equal(c.efficiency.credits.median, 2);
  assert.match(md, /model mismatch 60%/);
});

test('a mismatch or infra error is excluded even when the stored status says success', () => {
  const odd = [
    { arm: 'a', rep: 3, status: 'success', flags: ['modelMismatch'], credits: 0.1 },
    { arm: 'a', rep: 4, status: 'success', infraError: 'post-processing failed: x', credits: 0.1 },
  ];
  const { c } = cell([...goodRuns('a', 1, 2), ...odd]);
  assert.equal(c.counts.good, 2);
  assert.equal(c.rates.infraError, 1 / 4);
  assert.equal(c.rates.modelMismatch, 1 / 4);
  assert.equal(c.efficiency.credits.n, 2);
});

test('budget-skipped runs are reported apart and never counted', () => {
  const { c, md } = cell([...goodRuns('a', 1, 2), { arm: 'a', rep: 3, status: 'budget_skipped', credits: null, checks: [], wallClockMs: null }]);
  assert.equal(c.n, 2);
  assert.equal(c.skipped, 1);
  assert.match(md, /1 budget-skipped/);
});

test('compare uses the same series: fast crashes show up as a cost regression, not an improvement', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const base = makeRun(path.join(root, 'base'), bench, goodRuns('a', 1, 5));
    const crashes = [3, 4, 5].map((rep) => ({ arm: 'a', rep, status: 'error', credits: 0.02, wallClockMs: 3000, runFinishedStatus: null }));
    const head = makeRun(path.join(root, 'head'), bench, [...goodRuns('a', 1, 2), ...crashes]);
    const r = compareRuns({ baseDir: base, headDir: head, benchDir: bench });
    assert.equal(r.exitCode, 1);
    assert.equal(r.improvements.some((x) => x.metric === 'credits' || x.metric === 'wallClockMs'), false);
    assert.ok(r.regressions.some((x) => x.metric === 'checkPassRate'));
    assert.ok(r.regressions.some((x) => x.metric === 'creditsPerSuccessfulRun' || x.metric === 'successRate'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('compare refuses differing content hash, kiro-cli version and isolation mode; --force overrides', () => {
  const cases = [
    [{ contentHash: 'aaa' }, { contentHash: 'bbb' }, /content hash/],
    [{ kiroCliVersion: 'kiro-cli 2.35.1' }, { kiroCliVersion: 'kiro-cli 2.36.0' }, /kiro-cli version/],
    [{ isolation: { mode: 'unshare' } }, { isolation: { mode: 'none' } }, /isolation mode/],
  ];
  for (const [baseCfg, headCfg, re] of cases) {
    const root = tmp();
    try {
      const bench = makeBench(path.join(root, 'bench'));
      const specs = goodRuns('a', 1, 3);
      const base = makeRun(path.join(root, 'base'), bench, specs, baseCfg);
      const head = makeRun(path.join(root, 'head'), bench, specs, headCfg);
      const r = compareRuns({ baseDir: base, headDir: head, benchDir: bench });
      assert.equal(r.exitCode, 2, String(re));
      assert.match(r.refusals.join(' '), re);
      assert.equal(compareRuns({ baseDir: base, headDir: head, benchDir: bench, force: true }).exitCode, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
