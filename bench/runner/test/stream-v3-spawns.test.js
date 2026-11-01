// SPDX-License-Identifier: Apache-2.0
'use strict';

// Engine v3 names a tool call by `title` and carries no _meta.kiro.toolName; a sub-agent call is titled
// "Sub-agent: <name>" with the target in rawInput.name. The fixture is a coordinator run that spawned four
// k-architect calls (write, review, fix, re-review) before the task timeout ended it. Its stream is trimmed to tool
// events, paths scrubbed. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseStream, aggregateStream, subagentTargets, toolNameOf } = require('../lib/stream.js');
const om = require('../lib/orch-metrics.js');

const events = parseStream(fs.readFileSync(path.join(__dirname, 'fixtures', 'v3-orch-coord.stream.jsonl'), 'utf8')).events;

const tool = (title, extra = {}) => ({ sessionUpdate: 'tool_call', toolCallId: 't1', title, ...extra });

test('toolNameOf: v3 titles map to the tool names the engine reports in usedTools', () => {
  assert.equal(toolNameOf(tool('Read File', { kind: 'read' })), 'read_file');
  assert.equal(toolNameOf(tool('List Directory', { kind: 'search' })), 'list_directory');
  assert.equal(toolNameOf(tool('Write File', { kind: 'edit' })), 'fs_write');
  assert.equal(toolNameOf(tool('Replace in File', { kind: 'edit' })), 'str_replace');
  assert.equal(toolNameOf(tool('Run Command', { kind: 'execute' })), 'execute_bash');
  assert.equal(toolNameOf(tool('Grep Search', { kind: 'search' })), 'grep_search');
  assert.equal(toolNameOf(tool('Append to File', { kind: 'edit' })), 'fs_append');
  assert.equal(toolNameOf(tool('Load Resource')), 'load_resource');
  assert.equal(toolNameOf(tool('Tool Call')), 'tool_call');
  assert.equal(toolNameOf(tool('get_skill')), 'get_skill');
  assert.equal(toolNameOf(tool('@konductor-skills/get_skill')), 'get_skill');
});

test('toolNameOf: a command with a model-written title is still a command; an unknown title stays unknown', () => {
  assert.equal(toolNameOf(tool('Probe suspected vulnerabilities inline', { kind: 'execute' })), 'execute_bash');
  assert.equal(toolNameOf(tool('Tool Load')), null);
  assert.equal(toolNameOf(tool('Check the thing', { kind: 'think' })), null);
  assert.equal(toolNameOf({ sessionUpdate: 'tool_call' }), null);
});

test('toolNameOf: "Sub-agent: <name>" is a subagent call', () => {
  assert.equal(toolNameOf(tool('Sub-agent: k-architect')), 'subagent');
  assert.equal(toolNameOf(tool('Sub-agent: k-developer')), 'subagent');
});

test('toolNameOf: engine v2 is unchanged, the reported toolName wins over any title', () => {
  const v2 = (toolName, title = 'x') => tool(title, { _meta: { kiro: { toolName } } });
  assert.equal(toolNameOf(v2('subagent')), 'subagent');
  assert.equal(toolNameOf(v2('write', 'Read File')), 'write');
  assert.equal(toolNameOf(v2('fs_read', 'Sub-agent: k-architect')), 'fs_read');
  assert.equal(toolNameOf({ sessionUpdate: 'tool_call', _meta: { kiro: {} } }), null);
});

test('subagentTargets reads rawInput.name only for a v3 call, so a v2 stage name is never taken for an agent', () => {
  assert.deepEqual(subagentTargets({ name: 'k-architect', prompt: 'p' }), ['(unnamed)']);
  assert.deepEqual(subagentTargets({ name: 'k-architect', prompt: 'p' }, { nameIsAgent: true }), ['k-architect']);
  assert.deepEqual(subagentTargets({ stages: [{ name: 'a', role: 'k-developer' }] }, { nameIsAgent: true }), ['k-developer']);
  assert.deepEqual(subagentTargets({ prompt: 'p' }, { nameIsAgent: true }), ['(unnamed)']);
});

test('aggregateStream counts the v3 sub-agent calls and keeps them out of the work tool calls', () => {
  const agg = aggregateStream(events);
  assert.equal(agg.subagentCalls, 4);
  assert.deepEqual(agg.delegatedTo, { 'k-architect': 4 });
  assert.equal(agg.toolNames.subagent, 4);
  assert.equal(agg.toolNames.read_file > 0, true);
  assert.equal(agg.toolCalls - agg.workToolCalls, 4);
  assert.equal(agg.toolNames.unknown > 0, true, 'titles with no evidence behind them stay unknown');
});

test('spawnTree finds the four spawns, each issued by the root at depth 1', () => {
  const tree = om.spawnTree(events);
  assert.equal(tree.spawnCalls, 4);
  assert.equal(tree.spawns, 4);
  assert.equal(tree.maxSpawnDepth, 1);
  assert.equal(tree.childSessions, 4);
  assert.deepEqual(tree.calls.map((c) => c.targets), [['k-architect'], ['k-architect'], ['k-architect'], ['k-architect']]);
  assert.deepEqual(tree.calls.map((c) => c.status), ['completed', 'completed', 'completed', null], 'the last call was still running when the run ended');
});

test('orchMetrics reads the review flow from the v3 calls', () => {
  const m = om.orchMetrics({ events });
  assert.equal(m.spawns, 4);
  assert.equal(m.maxSpawnDepth, 1);
  assert.equal(m.reviewRounds, 1);
  assert.deepEqual(m.reviewVerdicts, ['fail']);
  assert.equal(m.reworksAfterPass, 0);
  // The fix pattern in profiles/orch-metrics.json also matches "Re-review ... after one fix pass ... findings", so
  // the re-review counts as a second fix and not as a second review round. The patterns are unchanged here.
  assert.equal(m.fixSpawns, 2);
  assert.deepEqual(om.reviewFlow(events).sequence, ['other', 'review', 'fix', 'fix']);
});

// ---- nesting, built from the same event shape ----
const SID = 'sess_root';
const ordinary = (subtask, id) => ({ type: 'sessionUpdate', data: { sessionId: SID, update: { sessionUpdate: 'tool_call', toolCallId: id, title: 'Read File', kind: 'read', _meta: { kiro: subtask ? { agentSubtaskId: subtask } : {} } } } });
const spawn = (callee, id, target) => ({ type: 'sessionUpdate', data: { sessionId: SID, update: { sessionUpdate: 'tool_call', toolCallId: id, title: `Sub-agent: ${target}`, rawInput: { name: target, prompt: 'p' }, _meta: { kiro: { kind: 'agent-subtask', agentSubtaskId: callee } } } } });
const end = (callee, id) => ({ type: 'sessionUpdate', data: { sessionId: SID, update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: 'ok', _meta: { kiro: { kind: 'agent-subtask', agentSubtaskId: callee } } } } });

test('a sub-agent call made by a sub-agent is one level deeper', () => {
  const tree = om.spawnTree([
    ordinary(null, 'r1'),
    spawn('A', 'invoke_subagent_1', 'k-developer'), ordinary('A', 'a1'),
    spawn('B', 'invoke_subagent_2', 'k-researcher'), ordinary('B', 'b1'), end('B', 'invoke_subagent_2'),
    ordinary('A', 'a2'), end('A', 'invoke_subagent_1'),
    ordinary(null, 'r2'),
    spawn('C', 'invoke_subagent_3', 'k-tpm'), end('C', 'invoke_subagent_3'),
  ]);
  assert.deepEqual(tree.calls.map((c) => c.depth), [1, 2, 1]);
  assert.equal(tree.maxSpawnDepth, 2);
  assert.equal(tree.spawns, 3);
  assert.equal(tree.childSessions, 3);
});

test('a v3 stream with no sub-agent call has no spawns and depth 0', () => {
  const tree = om.spawnTree([ordinary(null, 'r1'), ordinary(null, 'r2')]);
  assert.deepEqual({ calls: tree.spawnCalls, depth: tree.maxSpawnDepth, children: tree.childSessions }, { calls: 0, depth: 0, children: 0 });
});
