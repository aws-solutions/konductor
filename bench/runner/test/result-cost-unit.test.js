// SPDX-License-Identifier: Apache-2.0
'use strict';

// How buildResult and skippedResult treat a credit runtime and a USD runtime: censoring, the install harness, request
// counts, region and token estimate. Pinned for every runtime (and for an arm with no runtime) so that reading the unit
// from the descriptor changes nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResult, skippedResult, validateResult } = require('../lib/result.js');
const { aggregateStream } = require('../lib/stream.js');

const TASK = { id: 't1' };
const ENV = { kiroCliVersion: 'k', modelListSnapshotPath: null, region: 'us-test-1' };
const ev = (type, data) => ({ type, data });
const timedOut = { timedOut: true, exitCode: null, wallClockMs: 5000 };
const partial = () => aggregateStream([ev('metadata', { sessionId: 's1', turnDurationMs: 9, meteringUsage: [{ value: 0.4, unit: 'credit' }] })]);
const USAGE = { tokens: { input: 5, output: 3, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 8 }, costUsd: 0.25, modelCalls: 4, sessions: 2 };

const ARMS = {
  'kiro-cli': { id: 'a', label: 'a', ref: 'main', commitSha: 'abc', harness: 'kiro-cli-v2', runtime: 'kiro-cli', agent: 'konductor' },
  opencode: { id: 'oc-a', label: 'oc-a', ref: 'main', commitSha: 'abc', harness: 'none', runtime: 'opencode', agent: 'konductor' },
  'claude-code': { id: 'cc-a', label: 'cc-a', ref: 'main', commitSha: 'abc', harness: 'none', runtime: 'claude-code', agent: 'konductor' },
};
const CONFIG = (runtime) => (runtime === 'kiro-cli' ? { model: 'm', effort: 'high', agentEngine: 'v3' } : { model: 'm', effort: 'high' });
const build = (runtime, o = {}) => buildResult({ arm: ARMS[runtime], task: TASK, replicate: 1, config: CONFIG(runtime), exec: timedOut, agg: partial(), session: null, usage: runtime === 'kiro-cli' ? null : USAGE, checks: [], transcript: { chars: 40, bytes: 40, partial: false }, env: ENV, ...o });

test('a timed-out run is credit-censored on kiro-cli only, and cost-censored on the USD runtimes only', () => {
  const k = build('kiro-cli');
  assert.equal(k.creditsCensored, true);
  assert.equal(k.creditsLowerBound, 0.4);
  assert.equal(k.costCensored, null);
  for (const runtime of ['opencode', 'claude-code']) {
    const r = build(runtime);
    assert.equal(r.creditsCensored, false, runtime);
    assert.equal(r.creditsLowerBound, null, runtime);
    assert.equal(r.costCensored, true, runtime);
    assert.equal(build(runtime, { exec: { timedOut: false, exitCode: 0, wallClockMs: 1 }, agg: aggregateStream([ev('runFinished', { status: 'success', stopReason: 'end_turn' })]) }).costCensored, false, runtime);
  }
});

test('the install harness is the engine install for a kiro-cli arm and the arm harness for a USD runtime or a vanilla arm', () => {
  assert.equal(build('kiro-cli').installHarness, 'kiro-v3');
  assert.equal(build('kiro-cli', { arm: { ...ARMS['kiro-cli'], vanilla: true, harness: 'none' } }).installHarness, 'none');
  assert.equal(build('opencode').installHarness, 'none');
  assert.equal(build('claude-code').installHarness, 'none');
});

test('request counts, region and token estimate come from usage for a USD runtime and from the stream and transcript for kiro-cli', () => {
  const k = build('kiro-cli');
  assert.equal(k.harness, 'kiro-cli');
  assert.equal(k.region, null);
  assert.equal(k.costUsd, null);
  assert.deepEqual(k.estTokens, { value: 10, isEstimate: true });
  assert.deepEqual(k.modelCalls, { meteringEntries: 1, totalRequestCount: null });
  for (const runtime of ['opencode', 'claude-code']) {
    const r = build(runtime);
    assert.equal(r.harness, runtime);
    assert.equal(r.region, 'us-test-1', runtime);
    assert.equal(r.costUsd, 0.25, runtime);
    assert.deepEqual(r.estTokens, { value: 8, isEstimate: false }, runtime);
    assert.deepEqual(r.modelCalls, { meteringEntries: 4, totalRequestCount: 4 }, runtime);
    assert.equal(build(runtime, { usage: null }).estTokens, null, runtime);
    assert.equal(build(runtime, { usage: null }).modelCalls, null, runtime);
  }
});

test('an arm with no runtime is a kiro-cli arm', () => {
  const { runtime, ...bare } = ARMS['kiro-cli'];
  const r = build('kiro-cli', { arm: bare });
  assert.equal(r.harness, 'kiro-cli');
  assert.equal(r.creditsCensored, true);
  assert.equal(r.costCensored, null);
  assert.deepEqual(validateResult(r), []);
});

test('a budget-skipped run carries costCensored false for a USD runtime and no such field for kiro-cli', () => {
  const args = (runtime) => ({ arm: ARMS[runtime], task: TASK, replicate: 1, config: CONFIG(runtime), env: ENV });
  const k = skippedResult(args('kiro-cli'));
  assert.equal(k.status, 'budget_skipped');
  assert.equal(k.creditsCensored, false);
  assert.equal(k.costCensored, null);
  for (const runtime of ['opencode', 'claude-code']) {
    const r = skippedResult(args(runtime));
    assert.equal(r.status, 'budget_skipped', runtime);
    assert.equal(r.costCensored, false, runtime);
    assert.equal(r.creditsCensored, false, runtime);
    assert.deepEqual(validateResult(r), [], runtime);
  }
});
