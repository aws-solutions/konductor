// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalArgs, argsSha256, streamArgs } = require('../lib/plant/canonical.js');
const { plantCallsInStream, plantCallsInClaudeStream, streamCallsOf, plantCallsInGatewayLog, matchCalls } = require('../lib/plant/stream-match.js');
const { parseStream } = require('../lib/stream.js');

const PHYSICAL = path.join(__dirname, '..', '..', 'physical');
const CANONICAL = JSON.parse(fs.readFileSync(path.join(PHYSICAL, 'fixtures', 'canonical-args.json'), 'utf8')).vectors;
const STEP0_STREAM = fs.readFileSync(path.join(PHYSICAL, 'fixtures', 'step0', 'kiro-v2.plant.stream.jsonl'), 'utf8');
const STEP0_V3_STREAM = fs.readFileSync(path.join(PHYSICAL, 'fixtures', 'step0', 'kiro-v3.plant.stream.trimmed.jsonl'), 'utf8');
const V3_CALLS = JSON.parse(fs.readFileSync(path.join(PHYSICAL, 'fixtures', 'step0', 'kiro-v3.plant-calls.json'), 'utf8'));
const toolCall = (update) => ({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', ...update } } });

const call = (tool, args, id) => ({ toolCallId: id, callId: id, tool, argsSha256: argsSha256(args) });

test('canonical args match the vectors the Python gateway is tested against', () => {
  for (const v of CANONICAL) assert.equal(canonicalArgs(v.args), v.canonical);
});

test('the engine v2 purpose field is dropped from stream arguments', () => {
  assert.deepEqual(streamArgs({ speed_mmps: 300, __tool_use_purpose: 'slow down' }), { speed_mmps: 300 });
});

test('plant calls are read from a real engine v2 stream with their tool names', () => {
  const calls = plantCallsInStream(parseStream(STEP0_STREAM).events);
  assert.deepEqual(calls.map((c) => [c.tool, c.argsSha256]), [['get_state', argsSha256({})], ['fail_tool', argsSha256({})]]);
});

test('plant calls are read from a real engine v3 stream; its Tool Load of tool::plant::get_state is not a call', () => {
  const calls = plantCallsInStream(parseStream(STEP0_V3_STREAM).events);
  assert.deepEqual(calls.map((c) => [c.toolCallId, c.tool, c.argsSha256, c.engine]), [['toolu_bdrk_01X6hDGXkVqkwFehJHcrCW6M', 'get_state', argsSha256({}), 'v3']]);
});

test('each engine shape is read, or kept as an unreadable plant call, or left out when it is not a plant call', () => {
  const cases = [
    { why: 'v2 plant call', u: { title: 'Running: @plant/stop', rawInput: {}, _meta: { kiro: { toolName: 'stop', mcpServerName: 'plant' } } }, want: 'stop' },
    { why: 'v2 call on another server', u: { title: 'Running: @other/stop', rawInput: {}, _meta: { kiro: { toolName: 'stop', mcpServerName: 'other' } } }, want: undefined },
    { why: 'v2 built-in', u: { title: 'Reading', rawInput: {}, _meta: { kiro: { toolName: 'fs_read' } } }, want: undefined },
    { why: 'v3 titled call with serverName', u: { title: '@plant/stop', rawInput: {}, _meta: { kiro: { serverName: 'plant' } } }, want: 'stop' },
    { why: 'v3 titled call without serverName', u: { title: '@plant/stop', rawInput: {} }, want: 'stop' },
    { why: 'v3 deferred Tool Call', u: { title: 'Tool Call', rawInput: { tool_id: 'tool::plant::stop', arguments: {} } }, want: 'stop' },
    { why: 'v3 Tool Load of a plant tool', u: { title: 'Tool Load', rawInput: { id: 'tool::plant::stop' }, _meta: { kiro: { toolOrigin: 'default' } } }, want: undefined },
    { why: 'v3 call on another server', u: { title: '@other/stop', rawInput: {}, _meta: { kiro: { serverName: 'other' } } }, want: undefined },
    { why: 'v3 built-in', u: { title: 'Read File', rawInput: { path: 'x' } }, want: undefined },
    { why: 'v3 plant call with an unreadable title', u: { title: 'Plant thing', rawInput: {}, _meta: { kiro: { serverName: 'plant' } } }, want: null },
    { why: 'v3 plant call with no title', u: { rawInput: {}, _meta: { kiro: { serverName: 'plant' } } }, want: null },
    { why: 'v3 plant serverName on another server title', u: { title: '@other/stop', rawInput: {}, _meta: { kiro: { serverName: 'plant' } } }, want: null },
  ];
  for (const c of cases) {
    const calls = plantCallsInStream([toolCall({ toolCallId: 't', ...c.u })]);
    if (c.want === undefined) assert.deepEqual(calls, [], c.why);
    else assert.deepEqual(calls.map((x) => x.tool), [c.want], c.why);
  }
});

test('a plant call whose tool cannot be read is a stream-only mismatch, never a pair', () => {
  const stream = plantCallsInStream([toolCall({ toolCallId: 't1', title: 'Plant thing', rawInput: {}, _meta: { kiro: { serverName: 'plant' } } })]);
  const result = matchCalls(stream, [call('get_state', {}, 'c0')]);
  assert.deepEqual([result.pairs.length, result.streamOnly.map((c) => c.toolCallId), result.gatewayOnly.length], [0, ['t1'], 1]);
});

test('the canonical args hash of every stream call equals the gateway args_sha256 on a real engine v3 run, arguments included', () => {
  const stream = plantCallsInStream(V3_CALLS.stream);
  const gateway = plantCallsInGatewayLog(V3_CALLS.gateway);
  assert.equal(V3_CALLS.stream.length, 8);
  assert.deepEqual(stream.map((c) => c.tool), ['get_state', 'stop', 'get_state', 'request_approval']);
  assert.ok(Object.keys(V3_CALLS.gateway[3].args).length > 0);
  for (const g of V3_CALLS.gateway) assert.equal(argsSha256(g.args), g.args_sha256);
  const result = matchCalls(stream, gateway);
  assert.deepEqual([result.pairs.length, result.streamOnly.length, result.gatewayOnly.length], [4, 0, 0]);
});

test('arguments hash to the gateway value on both engines: v2 drops its purpose field, v3 unwraps a deferred call', () => {
  // args_sha256 values computed by the Python gateway (plant_gateway.tools.args_sha256).
  const gatewayHash = {
    speed: '4a6ba92cb96b01e48571d9e7742eaad0a3c92cb93efe1cbe50c3d2a53448b19f',
    approval: 'ce736f4f8edf5e9c5020f452b7591dfc5f31e292e298d4f2180111c01537a90f',
  };
  const approval = { reason: 'jam \u00fc', action: 'open_guard' };
  const cases = [
    { why: 'v2 with purpose', u: { title: 'Running: @plant/set_speed', rawInput: { speed_mmps: 300, __tool_use_purpose: 'slow' }, _meta: { kiro: { toolName: 'set_speed', mcpServerName: 'plant' } } }, want: gatewayHash.speed },
    { why: 'v2 keys in another order', u: { title: 'Running: @plant/request_approval', rawInput: { __tool_use_purpose: 'ask', ...approval }, _meta: { kiro: { toolName: 'request_approval', mcpServerName: 'plant' } } }, want: gatewayHash.approval },
    { why: 'v3 titled', u: { title: '@plant/set_speed', rawInput: { speed_mmps: 300 }, _meta: { kiro: { serverName: 'plant' } } }, want: gatewayHash.speed },
    { why: 'v3 titled, 300.0', u: { title: '@plant/set_speed', rawInput: JSON.parse('{"speed_mmps":300.0}'), _meta: { kiro: { serverName: 'plant' } } }, want: gatewayHash.speed },
    { why: 'v3 deferred Tool Call', u: { title: 'Tool Call', rawInput: { tool_id: 'tool::plant::request_approval', arguments: approval } }, want: gatewayHash.approval },
  ];
  for (const c of cases) assert.deepEqual(plantCallsInStream([toolCall({ toolCallId: 't', ...c.u })]).map((x) => x.argsSha256), [c.want], c.why);
});

const ccAssistant = (...content) => ({ type: 'assistant', message: { content } });
const ccUse = (tool, input, id) => ({ type: 'tool_use', id, name: `mcp__plant__${tool}`, input });

test('Claude Code plant calls are read from mcp__plant__ tool_use blocks, in stream order', () => {
  const events = [
    { type: 'system', subtype: 'init' },
    ccAssistant({ type: 'text', text: 'reading' }, ccUse('get_state', {}, 'tu1')),
    ccAssistant(ccUse('stop', {}, 'tu2'), { type: 'tool_use', id: 'x', name: 'Read', input: { file_path: '/p' } }),
    ccAssistant({ type: 'tool_use', id: 'y', name: 'mcp__other__stop', input: {} }),
  ];
  const calls = plantCallsInClaudeStream(events);
  assert.deepEqual(calls.map((c) => [c.toolCallId, c.tool, c.argsSha256, c.engine]), [
    ['tu1', 'get_state', argsSha256({}), 'claude-code'],
    ['tu2', 'stop', argsSha256({}), 'claude-code'],
  ]);
});

test('a Claude plant call hashes its arguments to the gateway args_sha256, and streamCallsOf routes claude-stream-json with no adapter', () => {
  // Same vector the Python gateway (plant_gateway.tools.args_sha256) is tested against.
  const speedHash = '4a6ba92cb96b01e48571d9e7742eaad0a3c92cb93efe1cbe50c3d2a53448b19f';
  const events = [ccAssistant(ccUse('set_speed', { speed_mmps: 300 }, 'tu1'))];
  const { calls, adapter } = streamCallsOf('claude-stream-json', events);
  assert.equal(adapter, null);
  assert.deepEqual(calls.map((c) => [c.tool, c.argsSha256]), [['set_speed', speedHash]]);
  const result = matchCalls(calls, plantCallsInGatewayLog([{ seq: 1, type: 'call', tool: 'set_speed', args_sha256: speedHash }]));
  assert.deepEqual([result.pairs.length, result.streamOnly.length, result.gatewayOnly.length], [1, 0, 0]);
});

test('a Claude mcp__plant__ name with nothing after it is an unreadable plant call, never a pair', () => {
  const stream = plantCallsInClaudeStream([ccAssistant({ type: 'tool_use', id: 'tu1', name: 'mcp__plant__', input: {} })]);
  const result = matchCalls(stream, [call('get_state', {}, 'c0')]);
  assert.deepEqual([stream.map((c) => c.tool), result.pairs.length, result.streamOnly.length], [[null], 0, 1]);
});

test('gateway calls take their call_id from seq and their key from args_sha256', () => {
  const lines = [{ seq: 4, type: 'call', tool: 'stop', args_sha256: 'h' }, { seq: 5, type: 'executed' }];
  assert.deepEqual(plantCallsInGatewayLog(lines), [{ callId: 'c4', tool: 'stop', argsSha256: 'h' }]);
});

test('equal calls in a different order still pair up', () => {
  const stream = [call('stop', {}, 's1'), call('get_state', {}, 's2'), call('get_state', {}, 's3')];
  const gateway = [call('get_state', {}, 'c0'), call('get_state', {}, 'c1'), call('stop', {}, 'c2')];
  const result = matchCalls(stream, gateway);
  assert.equal(result.pairs.length, 3);
  assert.deepEqual([result.streamOnly, result.gatewayOnly], [[], []]);
});

test('a stream call the gateway never saw is stream-only', () => {
  const result = matchCalls([call('open_guard', {}, 's1')], []);
  assert.deepEqual(result.streamOnly.map((c) => c.toolCallId), ['s1']);
});

test('the same tool with other arguments does not pair', () => {
  const result = matchCalls([call('set_speed', { speed_mmps: 300 }, 's1')], [call('set_speed', { speed_mmps: 900 }, 'c0')]);
  assert.deepEqual([result.pairs.length, result.streamOnly.length, result.gatewayOnly.length], [0, 1, 1]);
});
