// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseStream, aggregateStream } = require('../lib/stream.js');
const { makeCreditMeter } = require('../lib/credit-watch.js');
const { mkScratch } = require('./scratch.js');

const line = (o) => JSON.stringify(o);
const turnCompletion = (executionId, usage, extra = {}) => line({
  type: 'sessionUpdate',
  data: {
    sessionId: 'sess_1',
    update: {
      sessionUpdate: 'session_info_update',
      _meta: { kiro: { promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage, usedTools: ['fs_write'], ...extra }], elapsedTime: 67196, status: 'success', kind: 'turn_completion', executionId, turnId: executionId, requestIds: ['r1'] } },
    },
  },
});
const V3 = [
  line({ type: 'runStarted', data: { payloadSchema: 'acp', engine: 'v3' } }),
  turnCompletion('ex1', 1.9854780343946932),
  line({ type: 'runFinished', data: { sessionId: 'sess_1', status: 'success', stopReason: 'end_turn', finalText: 'done' } }),
].join('\n');

test('engine v3: credits come from the turn_completion summary', () => {
  const agg = aggregateStream(parseStream(V3).events);
  assert.ok(Math.abs(agg.credits - 1.9854780343946932) < 1e-12);
  assert.equal(agg.meteringEntries, 1);
  assert.equal(agg.turnDurationMs, 67196);
});

test('engine v3: a replayed turn_completion is counted once', () => {
  const agg = aggregateStream(parseStream(`${V3}\n${turnCompletion('ex1', 1.9854780343946932)}`).events);
  assert.equal(agg.meteringEntries, 1);
});

test('engine v3: a non-credit unit is flagged, not summed', () => {
  const text = [turnCompletion('ex1', 5, { unit: 'token' }), line({ type: 'runFinished', data: { status: 'success' } })].join('\n');
  const agg = aggregateStream(parseStream(text).events);
  assert.equal(agg.credits, 0);
  assert.deepEqual(agg.nonCreditUnits, ['token']);
});

test('engine v3: the live credit meter reads turn_completion too', () => {
  const dir = mkScratch('cw-');
  const file = path.join(dir, 'stream.jsonl');
  fs.writeFileSync(file, `${V3}\n`);
  try { assert.ok(Math.abs(makeCreditMeter(file).poll() - 1.9854780343946932) < 1e-12); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('engine v3: the live credit meter counts a replayed turn once, as the parser does', () => {
  const dir = mkScratch('cw-');
  const file = path.join(dir, 'stream.jsonl');
  fs.writeFileSync(file, `${V3}\n${turnCompletion('ex1', 1.9854780343946932)}\n${turnCompletion('ex2', 1)}\n`);
  try { assert.ok(Math.abs(makeCreditMeter(file).poll() - 2.9854780343946932) < 1e-12); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
