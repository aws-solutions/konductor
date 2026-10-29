// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench } = require('./helpers.js');
const { describePlan, requireBudget, BUDGET_REQUIRED_ABOVE } = require('../lib/orchestrate.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const tasks = [{ timeoutSec: 600 }, { timeoutSec: 900 }];

test('the plan states runs, the worst-case wall clock and the credit cap', () => {
  const p = describePlan({ tasks, arms: [1, 2, 3], replicates: 2, parallel: 3, budgetCredits: 60 });
  assert.equal(p.planned, 12);
  assert.equal(p.worstWallSec, (600 + 900) * 3 * 2 / 3);
  assert.match(p.text, /12 planned run\(s\); worst-case wall-clock 0\.8 h if every run times out \(parallel 3\); credit cap: 60 credits/);
  assert.match(describePlan({ tasks, arms: [1], replicates: 1, parallel: 1, budgetCredits: null }).text, /credit cap: none/);
});

test('more than 10 planned runs need --budget-credits; 10 or fewer do not', () => {
  assert.throws(() => requireBudget(BUDGET_REQUIRED_ABOVE + 1, null), /--budget-credits/);
  assert.doesNotThrow(() => requireBudget(BUDGET_REQUIRED_ABOVE, null));
  assert.doesNotThrow(() => requireBudget(500, 40));
});

test('run aborts before building anything when the plan is large and has no budget', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const r = spawnSync(process.execPath, [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--tasks', 't1', '--replicates', '11', '--bench-dir', bench, '--out', path.join(root, 'out'), '--isolate', 'none'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /11 runs are planned, more than 10: pass --budget-credits/);
    assert.equal(fs.existsSync(path.join(root, 'out')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--isolate auto aborts when the namespace cannot be set up; --isolate none goes on', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const env = { PATH: '/nonexistent', HOME: root, TMPDIR: os.tmpdir() };
    const args = (iso) => [BENCH_JS, 'run', '--suite', 'lite', '--arms', 'vanilla', '--tasks', 't1', '--bench-dir', bench, '--out', path.join(root, 'out'), '--isolate', iso];
    const auto = spawnSync(process.execPath, args('auto'), { encoding: 'utf8', env });
    assert.equal(auto.status, 1);
    assert.match(auto.stderr, /namespace isolation is unavailable.*--isolate none/);
    const none = spawnSync(process.execPath, args('none'), { encoding: 'utf8', env });
    assert.doesNotMatch(none.stderr, /namespace isolation is unavailable/);
    assert.match(none.stderr, /isolation: none \(requested\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
