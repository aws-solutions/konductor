// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStream, aggregateStream, summarizeSessionJson, detectAskedUser } = require('../lib/stream.js');

const line = (o) => JSON.stringify(o);
const toolCall = (id, toolName) => line({
  type: 'sessionUpdate',
  data: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: id, _meta: { kiro: { toolName } } } },
});
const toolUpdate = (id) => line({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: id } } });

const SAMPLE = [
  line({ type: 'runStarted', data: { engine: 'v2' } }),
  line({ type: 'metadata', data: { sessionId: 's1', contextUsagePercentage: 1.5 } }),
  toolCall('t1', 'shell'),
  toolUpdate('t1'),
  toolCall('t2', 'subagent'),
  toolCall('t3', 'find_skills'),
  line({ type: 'metadata', data: { sessionId: 's2', contextUsagePercentage: 2, turnDurationMs: 700, meteringUsage: [{ value: 0.1, unit: 'credit' }, { value: 0.2, unit: 'credit' }] } }),
  line({ type: 'metadata', data: { sessionId: 's1', contextUsagePercentage: 3, turnDurationMs: 1500, meteringUsage: [{ value: 0.25, unit: 'credit' }] } }),
  line({ type: 'runFinished', data: { sessionId: 's1', status: 'success', stopReason: 'end_turn', finalText: 'ok' } }),
].join('\n');

test('parseStream skips blank and malformed lines and counts them', () => {
  const { events, badLines } = parseStream('{"type":"a"}\n\nnot json\n{"type":"b"}\n');
  assert.deepEqual(events.map((e) => e.type), ['a', 'b']);
  assert.equal(badLines, 1);
});

test('aggregateStream sums metering across turns and counts tool_call events once', () => {
  const agg = aggregateStream(parseStream(SAMPLE).events);
  assert.ok(Math.abs(agg.credits - 0.55) < 1e-9);
  assert.equal(agg.meteringEntries, 3);
  assert.equal(agg.toolCalls, 3);
  assert.equal(agg.subagentCalls, 1);
  assert.deepEqual(agg.toolNames, { shell: 1, subagent: 1, find_skills: 1 });
  assert.equal(agg.runFinishedStatus, 'success');
  assert.equal(agg.sessionId, 's1');
  assert.deepEqual(agg.sessionIds, ['s1', 's2']);
  assert.equal(agg.engine, 'v2');
});

test('aggregateStream takes the last turnDurationMs and context percentage', () => {
  const agg = aggregateStream(parseStream(SAMPLE).events);
  assert.equal(agg.turnDurationMs, 1500);
  assert.equal(agg.contextUsagePercentage, 3);
});

test('aggregateStream de-duplicates repeated tool_call events with the same id', () => {
  const agg = aggregateStream(parseStream([toolCall('t1', 'shell'), toolCall('t1', 'shell')].join('\n')).events);
  assert.equal(agg.toolCalls, 1);
});

test('aggregateStream on an empty stream reports nothing finished', () => {
  const agg = aggregateStream([]);
  assert.equal(agg.runFinishedStatus, null);
  assert.equal(agg.meteringEntries, 0);
  assert.equal(agg.toolCalls, 0);
});

test('summarizeSessionJson reads request counts and the recorded model', () => {
  const session = {
    session_state: { conversation_metadata: { user_turn_metadatas: [
      { total_request_count: 2, builtin_tool_uses: 1, model: 'm1', metering_usage: [{ value: 0.5 }] },
      { total_request_count: 3, builtin_tool_uses: 0, model: 'm2', metering_usage: [{ value: 0.25 }] },
    ] } },
  };
  assert.deepEqual(summarizeSessionJson(session), {
    turns: 2, totalRequestCount: 5, builtinToolUses: 1, model: 'm2', meteringTotal: 0.75,
  });
  assert.equal(summarizeSessionJson({}).totalRequestCount, null);
});

test('workToolCalls leaves out the subagent call and the subagent summary pseudo-tool', () => {
  const agg = aggregateStream(parseStream([
    toolCall('a', 'subagent'), toolCall('b', 'write'), toolCall('c', 'read'), toolCall('d', 'summary'),
  ].join('\n')).events);
  assert.equal(agg.toolCalls, 4);
  assert.equal(agg.workToolCalls, 2);
});

test('turnDurationMs is null when the stream has no runFinished (timeout or crash)', () => {
  const events = parseStream(SAMPLE.split('\n').slice(0, -1).join('\n')).events;
  const agg = aggregateStream(events);
  assert.equal(agg.runFinishedStatus, null);
  assert.equal(agg.turnDurationMs, null);
});

test('metering entries whose unit is not credit are not summed and are reported', () => {
  const agg = aggregateStream(parseStream(line({
    type: 'metadata', data: { sessionId: 's1', meteringUsage: [{ value: 1, unit: 'credit' }, { value: 99, unit: 'token' }, { value: 5 }] },
  })).events);
  assert.equal(agg.credits, 1);
  assert.equal(agg.meteringEntries, 1);
  assert.deepEqual(agg.nonCreditUnits, ['token', undefined]);
});

test('finalTextTruncated is read from runFinished', () => {
  const agg = aggregateStream(parseStream(line({ type: 'runFinished', data: { status: 'success', stopReason: 'end_turn', finalText: 'x', finalTextTruncated: true } })).events);
  assert.equal(agg.finalTextTruncated, true);
});

test('detectAskedUser flags trailing questions, approval requests and non end_turn stops', () => {
  const base = { runFinishedStatus: 'success', stopReason: 'end_turn' };
  assert.equal(detectAskedUser({ ...base, finalText: 'Done.\n\nWhich option do you prefer?' }), true);
  assert.equal(detectAskedUser({ ...base, finalText: 'Plan ready. Shall I proceed with the changes' }), true);
  assert.equal(detectAskedUser({ ...base, finalText: 'Should I continue?**' }), true);
  assert.equal(detectAskedUser({ ...base, finalText: 'All tests pass. Let me know if you need more.' }), false);
  assert.equal(detectAskedUser({ ...base, finalText: 'Why did it fail? Because of X.\n\nFixed it.' }), false);
  assert.equal(detectAskedUser({ ...base, stopReason: 'max_tokens', finalText: 'cut off' }), true);
  assert.equal(detectAskedUser({ runFinishedStatus: null, stopReason: null, finalText: null }), null);
});

const mcpCall = (id, toolName, server) => line({
  type: 'sessionUpdate',
  data: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: id, _meta: { kiro: { toolName, mcpServerName: server } } } },
});
const mcpResult = (id, isError) => line({
  type: 'sessionUpdate',
  data: { sessionId: 's1', update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: { items: [{ Json: { isError } }] } } },
});

test('skillsMcpOk is null without skill calls, true when a call succeeds, false when all fail', () => {
  assert.equal(aggregateStream(parseStream(toolCall('t', 'shell')).events).skillsMcpOk, null);
  const ok = aggregateStream(parseStream([mcpCall('a', 'find_skills', 'konductor-skills'), mcpResult('a', false)].join('\n')).events);
  assert.equal(ok.skillsMcpOk, true);
  const bad = aggregateStream(parseStream([mcpCall('a', 'get_skill', 'konductor-skills'), mcpResult('a', true)].join('\n')).events);
  assert.equal(bad.skillsMcpOk, false);
  const other = aggregateStream(parseStream([mcpCall('a', 'find_skills', 'someone-else'), mcpResult('a', false)].join('\n')).events);
  assert.equal(other.skillsMcpOk, null);
});
