// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench } = require('./helpers.js');
const { describePlan, budgetNote, LARGE_PLAN_RUNS } = require('../lib/orchestrate.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const tasks = [{ timeoutSec: 600 }, { timeoutSec: 900 }];

test('the plan states runs, the worst-case wall clock and the credit cap', () => {
  const p = describePlan({ tasks, arms: [1, 2, 3], replicates: 2, parallel: 3, budgetCredits: 60 });
  assert.equal(p.planned, 12);
  assert.equal(p.worstWallSec, (600 + 900) * 3 * 2 / 3);
  assert.match(p.text, /12 planned run\(s\); worst-case wall-clock 0\.8 h if every run times out \(parallel 3\); credit cap: 60 credits/);
  assert.match(describePlan({ tasks, arms: [1], replicates: 1, parallel: 1, budgetCredits: null }).text, /credit cap: none/);
});

test('a large plan with no cap is allowed and gets a note that spending is tracked but not stopped', () => {
  assert.equal(LARGE_PLAN_RUNS, 10);
  assert.equal(budgetNote(LARGE_PLAN_RUNS, null), null);
  assert.equal(budgetNote(500, 40), null);
  assert.match(budgetNote(LARGE_PLAN_RUNS + 1, null), /11 runs are planned and no credit cap is set.*credit-ledger\.jsonl.*--budget-credits X/);
  assert.match(budgetNote(11, null, 'budget-usd'), /--budget-usd X/);
});

test('run no longer aborts on a large plan without a budget; it tracks credits and goes on to the next check', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    const r = spawnSync(process.execPath, [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--tasks', 't1', '--replicates', '11', '--bench-dir', bench, '--out', path.join(root, 'out'), '--isolate', 'none', '--allow-unisolated'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, TMPDIR: root } });
    assert.doesNotMatch(r.stderr, /more than 10: pass --budget-credits/);
    assert.match(r.stderr, /11 runs are planned and no credit cap is set/);
    assert.match(r.stderr, /kiro-cli auth database not found/);
    assert.equal(fs.existsSync(path.join(root, 'out')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--isolate auto aborts when OS isolation cannot be set up; --isolate none goes on', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const env = { PATH: '/nonexistent', HOME: root, TMPDIR: os.tmpdir() };
    const args = (iso) => [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--tasks', 't1', '--bench-dir', bench, '--out', path.join(root, 'out'), '--isolate', iso, ...(iso === 'none' ? ['--allow-unisolated'] : [])];
    const auto = spawnSync(process.execPath, args('auto'), { encoding: 'utf8', env });
    assert.equal(auto.status, 1);
    assert.match(auto.stderr, /isolation is unavailable.*--isolate none/);
    const none = spawnSync(process.execPath, args('none'), { encoding: 'utf8', env });
    assert.doesNotMatch(none.stderr, /isolation is unavailable/);
    assert.match(none.stderr, /isolation: none \(requested\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
