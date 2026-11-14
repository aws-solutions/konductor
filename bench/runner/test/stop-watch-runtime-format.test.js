// SPDX-License-Identifier: Apache-2.0
'use strict';

// The stop watcher reads one of two event shapes: opencode's JSON events, or the kiro-cli ACP updates. A runtime that is
// not opencode (Claude Code, an unknown name, no name) is read as kiro-cli. Pins that split for every runtime.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { makeStopWatcher } = require('../lib/stop-watch.js');

const ndjson = (...events) => `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
const ocTool = (tool, callID) => ({ type: 'tool_use', part: { tool, callID, state: { status: 'completed', input: { name: 'alpha' } } } });
const ocStep = (reason) => ({ type: 'step_finish', part: { reason } });
const kiroCall = (id, tool, server) => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: id, rawInput: { name: 'alpha' }, _meta: { kiro: { toolName: tool, ...(server ? { mcpServerName: server } : {}) } } } } });
const kiroDone = (id) => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: { items: [] } } } });
const kiroFinished = { type: 'runFinished', data: { status: 'success' } };

function poll(runtime, events, opts = {}) {
  const root = tmp();
  const file = path.join(root, 'stream.jsonl');
  try {
    fs.writeFileSync(file, ndjson(...events));
    const w = makeStopWatcher(file, { stopOn: 'first-capability', graceMs: 0, ...(runtime === undefined ? {} : { runtime }), ...opts });
    return w.poll();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const NOT_OPENCODE = ['kiro-cli', 'claude-code', 'nonesuch', undefined];

test('opencode: a skill or task call is a capability call, whatever the stop-on mode but end_turn', () => {
  for (const stopOn of ['first-capability', 'first-load']) {
    assert.deepEqual(poll('opencode', [ocTool('skill', 'a')], { stopOn }), { reason: 'first-capability', detail: 'skill' }, stopOn);
    assert.deepEqual(poll('opencode', [ocTool('task', 'a')], { stopOn }), { reason: 'first-capability', detail: 'task' }, stopOn);
  }
  assert.equal(poll('opencode', [ocTool('read', 'a'), ocTool('bash', 'b')]), null);
  assert.equal(poll('opencode', [ocTool('skill', 'a')], { stopOn: 'end_turn' }), null);
});

test('opencode: the turn ends on a step_finish whose reason is not tool-calls', () => {
  assert.deepEqual(poll('opencode', [ocTool('read', 'a'), ocStep('stop')], { stopOn: 'end_turn' }), { reason: 'end_turn', detail: 'runFinished' });
  assert.equal(poll('opencode', [ocTool('read', 'a'), ocStep('tool-calls')], { stopOn: 'end_turn' }), null);
  assert.equal(poll('opencode', [{ type: 'step_finish', part: {} }], { stopOn: 'end_turn' }), null);
});

test('opencode: max-tool-calls counts distinct call ids', () => {
  assert.equal(poll('opencode', [ocTool('read', 'a'), ocTool('read', 'a')], { stopOn: 'end_turn', maxToolCalls: 2 }), null);
  assert.deepEqual(poll('opencode', [ocTool('read', 'a'), ocTool('read', 'b')], { stopOn: 'end_turn', maxToolCalls: 2 }), { reason: 'max-tool-calls', detail: '2' });
});

test('opencode: kiro-cli events are ignored', () => {
  assert.equal(poll('opencode', [kiroCall('1', 'subagent'), kiroFinished], { stopOn: 'end_turn' }), null);
  assert.equal(poll('opencode', [kiroCall('1', 'subagent')]), null);
});

test('every other runtime reads kiro-cli events: runFinished ends the turn, a subagent call is a capability call', () => {
  for (const runtime of NOT_OPENCODE) {
    assert.deepEqual(poll(runtime, [kiroFinished], { stopOn: 'end_turn' }), { reason: 'end_turn', detail: 'runFinished' }, String(runtime));
    assert.deepEqual(poll(runtime, [kiroCall('1', 'subagent'), kiroDone('1')]), { reason: 'first-capability', detail: 'subagent' }, String(runtime));
    assert.deepEqual(poll(runtime, [kiroCall('1', 'get_skill', 'konductor-skills'), kiroDone('1')]), { reason: 'first-capability', detail: 'get_skill' }, String(runtime));
    assert.equal(poll(runtime, [kiroCall('1', 'find_skills', 'konductor-skills'), kiroDone('1')], { stopOn: 'first-load' }), null, `${runtime}: a find_skills call is not a load`);
    assert.deepEqual(poll(runtime, [kiroCall('1', 'read'), kiroCall('2', 'read')], { stopOn: 'end_turn', maxToolCalls: 2 }), { reason: 'max-tool-calls', detail: '2' }, String(runtime));
  }
});

test('every other runtime ignores opencode events', () => {
  for (const runtime of NOT_OPENCODE) {
    assert.equal(poll(runtime, [ocTool('skill', 'a'), ocStep('stop')], { stopOn: 'end_turn' }), null, String(runtime));
    assert.equal(poll(runtime, [ocTool('task', 'a')]), null, String(runtime));
  }
});
