// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResult, crossCheckCredits, validateResult } = require('../lib/result.js');
const { aggregateStream } = require('../lib/stream.js');

const ARM = { id: 'v1.2.0', label: 'v1.2.0', ref: 'v1.2.0', commitSha: 'abc', harness: 'kiro-cli-v2', agent: 'konductor' };
const TASK = { id: 't1' };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };
const ENV = { kiroCliVersion: 'k', modelListSnapshotPath: null };
const ok = { timedOut: false, exitCode: 0, wallClockMs: 1000 };
const ev = (type, data) => ({ type, data });
const finished = (credits = 1, finalText = 'done') => aggregateStream([
  ev('metadata', { sessionId: 's1', turnDurationMs: 500, meteringUsage: [{ value: credits, unit: 'credit' }] }),
  ev('runFinished', { status: 'success', stopReason: 'end_turn', finalText, finalTextTruncated: false }),
]);
const build = (o) => buildResult({ arm: ARM, task: TASK, replicate: 1, config: CONFIG, exec: ok, agg: finished(), session: null, checks: [], transcript: { chars: 40, bytes: 40, partial: false }, env: ENV, ...o });

test('a finished run is not censored and carries the new fields', () => {
  const r = build({});
  assert.deepEqual(validateResult(r), []);
  assert.equal(r.creditsCensored, false);
  assert.equal(r.creditsLowerBound, null);
  assert.equal(r.finalText, 'done');
  assert.equal(r.finalTextTruncated, false);
  assert.equal(r.askedUser, false);
  assert.deepEqual(r.flags, []);
});

test('a timeout without runFinished is censored; its partial credits are a lower bound', () => {
  const agg = aggregateStream([ev('metadata', { sessionId: 's1', turnDurationMs: 9, meteringUsage: [{ value: 0.4, unit: 'credit' }] })]);
  const r = build({ exec: { timedOut: true, exitCode: null, wallClockMs: 5000 }, agg });
  assert.equal(r.status, 'timeout');
  assert.equal(r.creditsCensored, true);
  assert.equal(r.credits, 0.4);
  assert.equal(r.creditsLowerBound, 0.4);
  assert.equal(r.turnDurationMs, null);
  assert.deepEqual(validateResult(r), []);
});

test('an error run with no metering at all has a zero lower bound, not a null one', () => {
  const r = build({ exec: { timedOut: false, exitCode: 1, wallClockMs: 10 }, agg: aggregateStream([]) });
  assert.equal(r.creditsCensored, true);
  assert.equal(r.credits, null);
  assert.equal(r.creditsLowerBound, 0);
});

test('a parent session on another model flags modelMismatch and turns success into error', () => {
  const r = build({ session: { model: 'claude-sonnet-5', totalRequestCount: 1, turns: 1, meteringTotal: 1 } });
  assert.equal(r.status, 'error');
  assert.ok(r.flags.includes('modelMismatch'));
  assert.match(r.error, /claude-sonnet-5, expected claude-sonnet-5.5/);
  assert.equal(r.creditsCensored, false);
});

test('a matching session model raises no flag', () => {
  const r = build({ session: { model: 'claude-sonnet-5.5', totalRequestCount: 1, turns: 1, meteringTotal: 1 } });
  assert.equal(r.status, 'success');
  assert.deepEqual(r.flags, []);
});

test('an infra error turns a success into an error but keeps the credits', () => {
  const r = build({ meta: { infraError: 'snapshot failed' } });
  assert.equal(r.status, 'error');
  assert.equal(r.credits, 1);
  assert.equal(r.infraError, 'snapshot failed');
  assert.equal(r.creditsCensored, false);
});

test('a setup failure before the agent started is not credit-censored', () => {
  const r = build({ exec: { timedOut: false, exitCode: null, wallClockMs: null, error: 'x' }, agg: null, meta: { agentStarted: false, infraError: 'x' } });
  assert.equal(r.creditsCensored, false);
});

test('a partial transcript and non-credit metering units are flagged', () => {
  const agg = aggregateStream([
    ev('metadata', { sessionId: 's1', meteringUsage: [{ value: 1, unit: 'credit' }, { value: 5, unit: 'token' }] }),
    ev('runFinished', { status: 'success', stopReason: 'end_turn', finalText: 'x' }),
  ]);
  const r = build({ agg, transcript: { chars: 4, bytes: 4, partial: true } });
  assert.ok(r.flags.includes('transcriptPartial'));
  assert.ok(r.flags.includes('meteringUnit'));
});

test('askedUser is recorded from the final message', () => {
  assert.equal(build({ agg: finished(1, 'Which file should I change?') }).askedUser, true);
});

test('crossCheckCredits compares session metering with the stream only when it can', () => {
  const s = (total, turns = 1) => ({ turns, meteringTotal: total });
  assert.deepEqual(crossCheckCredits(1.0, [s(1.0)]), { total: 1.0, mismatch: false });
  assert.equal(crossCheckCredits(1.0, [s(1.5)]).mismatch, true);
  assert.equal(crossCheckCredits(1.0, [s(0.3), { turns: 0, meteringTotal: 0 }]).mismatch, false, 'subagent session has no turn data');
  assert.equal(crossCheckCredits(1.0, [s(1.5), { turns: 0, meteringTotal: 0 }]).mismatch, true, 'sessions cannot exceed the stream');
  assert.deepEqual(crossCheckCredits(1.0, [{ turns: 0, meteringTotal: 0 }]), { total: null, mismatch: false });
  assert.deepEqual(crossCheckCredits(1.0, []), { total: null, mismatch: false });
});
