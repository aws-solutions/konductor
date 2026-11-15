// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalArgs, argsSha256, streamArgs } = require('../lib/plant/canonical.js');
const { plantCallsInStream, plantCallsInGatewayLog, matchCalls } = require('../lib/plant/stream-match.js');
const { parseStream } = require('../lib/stream.js');

const PHYSICAL = path.join(__dirname, '..', '..', 'physical');
const CANONICAL = JSON.parse(fs.readFileSync(path.join(PHYSICAL, 'fixtures', 'canonical-args.json'), 'utf8')).vectors;
const STEP0_STREAM = fs.readFileSync(path.join(PHYSICAL, 'fixtures', 'step0', 'kiro-v2.plant.stream.jsonl'), 'utf8');

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
