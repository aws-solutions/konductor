// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validate, loadSchema } = require('../lib/schema.js');
const { loadTasks, loadSuite, SUITE_DEFAULTS } = require('../lib/tasks.js');
const { buildResult, skippedResult, classifyStatus, validateResult } = require('../lib/result.js');
const { aggregateStream } = require('../lib/stream.js');

const TASK = {
  id: 't1', class: 'simple', target: null, prompt: 'p', fixture: 'f', timeoutSec: 60,
  checks: [{ type: 'file_exists', path: 'a' }, { type: 'cmd', cmd: 'true', expectExit: 0 }],
  rubric: [{ id: 'r', criterion: 'c', weight: 1 }], tiers: ['lite', 'full'],
};

test('task schema accepts a well-formed task', () => {
  assert.deepEqual(validate(loadSchema('task'), TASK), []);
});

test('task schema rejects bad class, tier, check type, extra keys and missing fields', () => {
  const schema = loadSchema('task');
  assert.ok(validate(schema, { ...TASK, class: 'other' }).length);
  assert.ok(validate(schema, { ...TASK, tiers: ['nightly'] }).length);
  assert.ok(validate(schema, { ...TASK, tiers: [] }).length);
  assert.ok(validate(schema, { ...TASK, checks: [{ type: 'regex' }] }).length);
  assert.ok(validate(schema, { ...TASK, timeoutSec: 1.5 }).length);
  assert.ok(validate(schema, { ...TASK, extra: 1 }).length);
  const { prompt, ...noPrompt } = TASK;
  assert.match(validate(schema, noPrompt).join('\n'), /missing required "prompt"/);
});

function benchDirWith(tasks, suites = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-dir-'));
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.mkdirSync(path.join(dir, 'fixtures/f'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'suites'));
  for (const t of tasks) fs.writeFileSync(path.join(dir, 'tasks', `${t.id}.json`), JSON.stringify(t));
  for (const [n, s] of Object.entries(suites)) fs.writeFileSync(path.join(dir, 'suites', `${n}.json`), JSON.stringify(s));
  return dir;
}

test('loadTasks validates files and resolves the fixture directory', () => {
  const dir = benchDirWith([TASK]);
  try {
    const tasks = loadTasks(dir);
    assert.equal(tasks.get('t1').fixtureDir, path.join(dir, 'fixtures/f'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadTasks throws on an invalid task, a missing fixture, and a duplicate id', () => {
  let dir = benchDirWith([{ ...TASK, class: 'nope' }]);
  assert.throws(() => loadTasks(dir), /invalid task file/);
  fs.rmSync(dir, { recursive: true, force: true });
  dir = benchDirWith([{ ...TASK, fixture: 'absent' }]);
  assert.throws(() => loadTasks(dir), /fixture dir missing/);
  fs.rmSync(dir, { recursive: true, force: true });
  dir = benchDirWith([TASK]);
  fs.writeFileSync(path.join(dir, 'tasks', 'copy.json'), JSON.stringify(TASK));
  assert.throws(() => loadTasks(dir), /duplicate task id/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadSuite applies the built-in defaults, and the suite file overrides them', () => {
  const dir = benchDirWith([TASK, { ...TASK, id: '_hidden' }]);
  try {
    const tasks = loadTasks(dir);
    const lite = loadSuite('lite', tasks, dir);
    assert.deepEqual(lite.arms, ['vanilla', 'v1.2.0', 'main']);
    assert.equal(lite.replicates, 1);
    assert.equal(lite.parallel, 1);
    assert.deepEqual(lite.taskIds, ['t1']);
    fs.writeFileSync(path.join(dir, 'suites/lite.json'), JSON.stringify({ tasks: ['t1'], parallel: 2 }));
    assert.equal(loadSuite('lite', tasks, dir).parallel, 2, 'a suite file keeps its own parallel value');
    fs.writeFileSync(path.join(dir, 'suites/full.json'), JSON.stringify({ tasks: ['t1'], replicates: 5 }));
    const full = loadSuite('full', tasks, dir);
    assert.equal(full.replicates, 5);
    assert.equal(full.parallel, 3);
    assert.deepEqual(full.arms, SUITE_DEFAULTS.full.arms);
    assert.throws(() => loadSuite('nightly', tasks, dir), /unknown suite/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const ARM = { id: 'v1.2.0', label: 'v1.2.0', ref: 'v1.2.0', commitSha: 'abc', harness: 'kiro-cli-v2', agent: 'konductor' };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };
const ENV = { kiroCliVersion: 'kiro-cli 2.35.1', modelListSnapshotPath: '/x/model-list.json' };

test('classifyStatus separates timeout, error and success', () => {
  assert.equal(classifyStatus({ timedOut: true, exitCode: null, runFinishedStatus: null }), 'timeout');
  assert.equal(classifyStatus({ timedOut: false, exitCode: 1, runFinishedStatus: 'success' }), 'error');
  assert.equal(classifyStatus({ timedOut: false, exitCode: 0, runFinishedStatus: null }), 'error');
  assert.equal(classifyStatus({ timedOut: false, exitCode: 0, runFinishedStatus: 'success' }), 'success');
});

test('buildResult produces a schema-valid result with the estimate flagged', () => {
  const agg = aggregateStream([
    { type: 'metadata', data: { sessionId: 's', turnDurationMs: 10, meteringUsage: [{ value: 0.5, unit: 'credit' }, { value: 0.25, unit: 'credit' }] } },
    { type: 'runFinished', data: { status: 'success' } },
  ]);
  const r = buildResult({
    arm: ARM, task: TASK, replicate: 2, config: CONFIG,
    exec: { timedOut: false, exitCode: 0, wallClockMs: 1234 },
    agg, session: { totalRequestCount: 2, model: 'claude-sonnet-5.5' },
    checks: [{ type: 'file_exists', passed: true }], transcript: { chars: 4001, bytes: 4100, partial: false }, env: ENV,
  });
  assert.deepEqual(validateResult(r), []);
  assert.equal(r.status, 'success');
  assert.equal(r.credits, 0.75);
  assert.deepEqual(r.modelCalls, { meteringEntries: 2, totalRequestCount: 2 });
  assert.deepEqual(r.estTokens, { value: 1000, isEstimate: true });
  assert.equal(r.replicate, 2);
});

test('a run that died early keeps a schema-valid error result with null metrics', () => {
  const r = buildResult({
    arm: ARM, task: TASK, replicate: 1, config: CONFIG,
    exec: { timedOut: false, exitCode: null, wallClockMs: null, error: 'boom' },
    agg: null, session: null, checks: [], transcript: null, env: ENV,
  });
  assert.deepEqual(validateResult(r), []);
  assert.equal(r.status, 'error');
  assert.equal(r.credits, null);
});

test('skippedResult is budget_skipped and schema-valid', () => {
  const r = skippedResult({ arm: ARM, task: TASK, replicate: 1, config: CONFIG, env: ENV });
  assert.equal(r.status, 'budget_skipped');
  assert.deepEqual(validateResult(r), []);
});

test('result schema rejects an unknown status', () => {
  const r = skippedResult({ arm: ARM, task: TASK, replicate: 1, config: CONFIG, env: ENV });
  assert.ok(validateResult({ ...r, status: 'maybe' }).length);
});
