// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseStream, mcpToolNameOf } = require('../../runner/lib/stream.js');

const DIR = path.join(__dirname, '..', 'fixtures', 'step0');
const lines = (name) => fs.readFileSync(path.join(DIR, name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sent = (name) => lines(name).filter((w) => w.dir === 'in').map((w) => w.line);
const updates = (name) => parseStream(fs.readFileSync(path.join(DIR, name), 'utf8')).events
  .map((e) => e.data?.update).filter(Boolean);
const toolCalls = (name) => updates(name).filter((u) => u.sessionUpdate === 'tool_call');

test('engine v2 sends initialize with MCP protocol version 2025-11-25', () => {
  const init = sent('kiro-v2.mcp-wire.jsonl').find((m) => m.method === 'initialize');
  assert.equal(init.params.protocolVersion, '2025-11-25');
});

test('engine v2 numbers JSON-RPC ids 0, 1, 2 per server, notifications carry none', () => {
  const ids = sent('kiro-v2.mcp-wire.jsonl').map((m) => m.id);
  assert.deepEqual(ids, [0, undefined, 1, 2, 3]);
});

test('the stream names a plant call by the model tool-use id, never by the JSON-RPC id', () => {
  const calls = toolCalls('kiro-v2.plant.stream.jsonl');
  assert.deepEqual(calls.map((u) => u._meta.kiro.toolName), ['get_state', 'fail_tool']);
  for (const u of calls) assert.match(u.toolCallId, /^toolu_/);
  const rpcIds = new Set(sent('kiro-v2.mcp-wire.jsonl').map((m) => m.id).filter((id) => id !== undefined));
  const streamText = fs.readFileSync(path.join(DIR, 'kiro-v2.plant.stream.jsonl'), 'utf8');
  assert.equal(/"(rpc_?[iI]d|jsonrpc)"/.test(streamText), false);
  for (const u of calls) assert.equal(rpcIds.has(u.toolCallId), false);
});

test('tools/call carries no tool-use id the gateway could join on', () => {
  for (const m of sent('kiro-v2.mcp-wire.jsonl').filter((x) => x.method === 'tools/call')) {
    assert.deepEqual(Object.keys(m.params).sort(), ['_meta', 'arguments', 'name']);
    assert.deepEqual(Object.keys(m.params._meta), ['progressToken']);
  }
});

test('a JSON-RPC error answer shows in the v2 stream only as status failed, with no output', () => {
  const failed = updates('kiro-v2.plant.stream.jsonl').find((u) => u.status === 'failed');
  assert.equal(failed.title, 'Running: @plant/fail_tool');
  assert.equal(failed.rawOutput, undefined);
});

test('engine v3 probes server/discover first, then falls back to initialize 2025-11-25', () => {
  const [probe, init] = sent('kiro-v3.mcp-wire.jsonl');
  assert.equal(probe.method, 'server/discover');
  assert.equal(probe.id, 'server-discover-probe-1');
  assert.equal(init.method, 'initialize');
  assert.equal(init.params.protocolVersion, '2025-11-25');
});

test('engine v3 loads a deferred plant tool before it calls it', () => {
  const [load, call] = toolCalls('kiro-v3.plant.stream.trimmed.jsonl');
  assert.equal(load.title, 'Tool Load');
  assert.equal(load.rawInput.id, 'tool::plant::get_state');
  assert.equal(mcpToolNameOf(call), 'get_state');
});

test('@builtin on engine v2 includes the subagent spawn tool', () => {
  const { namesReportedByModel } = JSON.parse(fs.readFileSync(path.join(DIR, 'kiro-v2.tool-names.json'), 'utf8'));
  assert.ok(namesReportedByModel.includes('subagent'));
});

test('--require-mcp-startup ends at init with a runError when the plant server cannot start', () => {
  const err = lines('kiro-v2.require-mcp-fail.stream.jsonl').find((e) => e.type === 'runError');
  assert.equal(err.data.stage, 'init');
  assert.match(err.data.message, /--require-mcp-startup/);
});
