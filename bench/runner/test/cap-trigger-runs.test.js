// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap trigger --mode runs`: the selection of a skill, SOP or agent read from the loadCheck of finished task runs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const trig = require('../../cap/trigger.js');
const { scoreTrigger } = require('../../cap/score.js');
const { makeCapRepo } = require('./cap-helpers.js');
const { makeRun, write, tmp } = require('./helpers.js');
const { mkScratch } = require('./scratch.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

const task = (id, o = {}) => ({ id, targets: { targetSkills: [], targetSop: null, targetAgent: null }, ...o });
const tasks = new Map([
  task('t-load', { targets: { targetSkills: ['alpha'], targetSop: 'k-plan', targetAgent: 'k-dev' } }),
  task('t-twin', { loadCheck: { mustNotLoad: ['alpha', 'sop:k-plan', 'k-dev'] } }),
  task('t-other', { targets: { targetSkills: ['beta'], targetSop: null, targetAgent: null } }),
  task('t-explicit', { loadCheck: { mustLoad: ['alpha'] }, targets: { targetSkills: ['beta'], targetSop: null, targetAgent: null } }),
].map((t) => [t.id, t]));

const unit = (name, kind, firstAt = 3, beforeFirstWrite = true) => ({ unit: name, kind, firstAt, beforeFirstWrite });
const res = (taskId, replicate, loaded, o = {}) => ({ taskId, replicate, status: 'success', armId: 'konductor', loadCheck: { loaded, mustLoad: [], mustNotLoaded: [] }, ...o });

test('loadCheckRows: a unit that loads on a should-load task is a hit, one that loads on a twin is a false load, other tasks are ignored', () => {
  const cap = { id: 'skill:alpha', kind: 'skill', name: 'alpha' };
  const { rows, dropped } = trig.loadCheckRows([
    res('t-load', 1, [unit('alpha', 'skill'), unit('k-plan', 'sop')]),
    res('t-load', 2, []),
    res('t-twin', 1, []),
    res('t-twin', 2, [unit('alpha', 'skill', 5, false)]),
    res('t-other', 1, [unit('alpha', 'skill')]),
    res('t-explicit', 1, [unit('alpha', 'skill', 9, false)]),
  ], cap, tasks);
  assert.deepEqual(rows.map((r) => [r.queryId, r.rep, r.expect, r.hit, r.beforeWrite]), [
    ['t-load', 1, 'load', true, true], ['t-load', 2, 'load', false, false], ['t-twin', 1, 'none', false, false], ['t-twin', 2, 'none', true, false], ['t-explicit', 1, 'load', true, false],
  ]);
  assert.deepEqual(rows[0].fired, ['sop:k-plan']);
  assert.equal(dropped.unrelated, 1);
  assert.deepEqual(trig.loadShares(rows), { shouldRuns: 3, loaded: 2, beforeWrite: 1, falseRuns: 2, falseLoads: 1 });
  const s = scoreTrigger(rows);
  assert.deepEqual([s.tp, s.fn, s.fp, s.tn], [2, 0, 1, 0], 'a query is positive when it fired in at least half of its runs');
});

test('loadCheckRows reads SOPs and agents by kind: a skill of the same name is not the SOP', () => {
  const sop = trig.loadCheckRows([res('t-load', 1, [unit('k-plan', 'sop')]), res('t-load', 2, [unit('k-plan', 'skill')])], { id: 'sop:k-plan', kind: 'sop', name: 'k-plan' }, tasks);
  assert.deepEqual(sop.rows.map((r) => r.hit), [true, false]);
  const agent = trig.loadCheckRows([res('t-load', 1, [unit('k-dev', 'agent')]), res('t-twin', 1, [unit('k-dev', 'agent')])], { id: 'agent:k-dev', kind: 'agent', name: 'k-dev' }, tasks);
  assert.deepEqual(agent.rows.map((r) => [r.expect, r.hit]), [['load', true], ['none', true]]);
  // The key ignores case, a kind prefix and the sop- wrapper.
  assert.deepEqual(trig.taskExpectations({ loadCheck: { mustLoad: ['SOP-K-Plan', 'skill:Alpha'] } }).mustLoad, ['k-plan', 'alpha']);
});

test('loadCheckRows drops a run with no loadCheck, an infra error, a skipped run, an unknown task, and a failed run that did not load', () => {
  const cap = { id: 'skill:alpha', kind: 'skill', name: 'alpha' };
  const { rows, dropped } = trig.loadCheckRows([
    res('t-load', 1, [unit('alpha', 'skill')], { loadCheck: null }),
    res('t-load', 2, [], { infraError: true }),
    res('t-load', 3, [], { status: 'budget_skipped' }),
    res('nope', 1, []),
    res('t-load', 4, [], { status: 'timeout' }),
    res('t-load', 5, [unit('alpha', 'skill')], { status: 'timeout' }),
    res('t-load', 6, [], { flags: ['modelMismatch'] }),
  ], cap, tasks);
  assert.deepEqual(rows.map((r) => r.rep), [5]);
  assert.deepEqual(dropped, { notRun: 1, noLoadCheck: 1, noTask: 1, unrelated: 0, infra: 1, failed: 2 });
});

test('the CLI reads a finished run directory and writes the report; with no usable run it refuses', () => {
  const root = mkScratch('captrig-');
  try {
    const r0 = makeCapRepo(root, { tag: 'v0' });
    const bench = path.join(root, 'bench');
    const mk = (id, extra) => write(path.join(bench, 'tasks', `${id}.json`), JSON.stringify({ id, class: 'simple', prompt: 'p', fixture: 'fx', timeoutSec: 60, checks: [], rubric: [], tiers: ['lite'], ...extra }));
    write(path.join(bench, 'fixtures/fx/a.txt'), 'a\n');
    write(path.join(bench, 'fixtures/fx/b.txt'), 'b\n');
    write(path.join(bench, 'fixtures/fx/.bench-answer-key.md'), 'k\n');
    mk('t-load', { targetSkills: ['alpha'] });
    mk('t-twin', { targetSkills: ['beta'], loadCheck: { mustNotLoad: ['alpha'] } });
    const lc = (loaded) => ({ source: 'targets', firstWriteAt: 10, loaded, mustLoad: [], mustLoadBeforeWrite: null, mustNotLoaded: [] });
    const runDir = path.join(root, 'run');
    makeRun(runDir, bench, [
      { arm: 'konductor', task: 't-load', rep: 1, loadCheck: lc([unit('alpha', 'skill', 2, true)]) },
      { arm: 'konductor', task: 't-load', rep: 2, loadCheck: lc([unit('alpha', 'skill', 12, false)]) },
      { arm: 'konductor', task: 't-twin', rep: 1, loadCheck: lc([]) },
      { arm: 'vanilla', task: 't-load', rep: 1 },
    ], { taskIds: ['t-load', 't-twin'] });
    const home = path.join(root, 'h');
    fs.mkdirSync(home);
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: root };
    const out = path.join(root, 'out');
    const run = (cap, extra = []) => spawnSync(process.execPath, [BENCH_JS, 'cap', 'trigger', '--cap', cap, '--mode', 'runs', '--from-runs', runDir, '--out', out, '--repo-root', r0.repo, '--bench-dir', bench, '--base', 'v0', ...extra], { encoding: 'utf8', env });
    const r = run('skill:alpha');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /should-load runs that loaded alpha: 2 of 2 \(100%\)/);
    assert.match(r.stdout, /loaded before the first file write: 1 of 2 \(50%\)/);
    assert.match(r.stdout, /false loads .*: 0 of 1 \(0%\)/);
    assert.match(r.stdout, /noLoadCheck 1/);
    const file = fs.readdirSync(out).find((n) => /^trigger-skill-alpha-.*-runs\.json$/.test(n));
    assert.ok(file, fs.readdirSync(out).join(','));
    const j = JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
    assert.equal(j.mode, 'runs');
    assert.equal(j.rows.length, 3);
    const none = run('skill:beta', ['--from-arm', 'vanilla']);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /no run in .* counts for skill:beta/);
    const noDirs = spawnSync(process.execPath, [BENCH_JS, 'cap', 'trigger', '--cap', 'skill:alpha', '--mode', 'runs', '--out', out, '--repo-root', r0.repo, '--bench-dir', bench, '--base', 'v0'], { encoding: 'utf8', env });
    assert.equal(noDirs.status, 2);
    assert.match(noDirs.stderr, /needs --from-runs/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
