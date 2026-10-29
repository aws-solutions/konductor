// SPDX-License-Identifier: Apache-2.0
'use strict';

// A real stream captured from a delegating run (parent plus one subagent), paths scrubbed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseStream, aggregateStream } = require('../lib/stream.js');
const { buildResult, validateResult } = require('../lib/result.js');

const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'delegating-smoke.stream.jsonl'), 'utf8');
const { events, badLines } = parseStream(text);
const agg = aggregateStream(events);

test('every line of the captured stream parses', () => {
  assert.equal(badLines, 0);
  assert.ok(events.length > 30);
});

test('credits sum the parent and subagent metering entries', () => {
  const entries = events.flatMap((e) => (e.type === 'metadata' ? e.data.meteringUsage || [] : []));
  assert.equal(agg.meteringEntries, entries.length);
  assert.equal(agg.meteringEntries, 6);
  assert.ok(Math.abs(agg.credits - entries.reduce((s, m) => s + m.value, 0)) < 1e-12);
  assert.equal(agg.nonCreditUnits.length, 0);
});

test('tool calls separate delegation overhead from work', () => {
  assert.deepEqual(agg.toolNames, { subagent: 1, write: 1, read: 1, summary: 1 });
  assert.equal(agg.toolCalls, 4);
  assert.equal(agg.workToolCalls, 2);
  assert.equal(agg.subagentCalls, 1);
});

test('both sessions are seen, the parent first, and the parent turn duration is used', () => {
  assert.equal(agg.sessionIds.length, 2);
  assert.equal(agg.sessionId, agg.sessionIds[0]);
  assert.equal(agg.turnDurationMs, 12998);
});

test('the final message is kept and is not a request for input', () => {
  assert.equal(agg.runFinishedStatus, 'success');
  assert.equal(agg.stopReason, 'end_turn');
  assert.equal(agg.finalTextTruncated, false);
  assert.match(agg.finalText, /hello\.txt/);
  assert.equal(agg.askedUser, false);
});

test('the real stream yields a schema-valid, uncensored result', () => {
  const r = buildResult({
    arm: { id: 'v1.2.0', label: 'v1.2.0', ref: 'v1.2.0', commitSha: 'x', harness: 'kiro-cli-v2', agent: 'konductor' },
    task: { id: '_smoke' }, replicate: 1, config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' },
    exec: { timedOut: false, exitCode: 0, wallClockMs: 16223 }, agg, session: null, checks: [],
    transcript: { chars: 100, bytes: 100, partial: false }, env: {},
  });
  assert.deepEqual(validateResult(r), []);
  assert.equal(r.creditsCensored, false);
  assert.equal(r.finalText, agg.finalText);
});
