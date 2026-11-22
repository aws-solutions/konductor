// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStream, aggregateStream, mergeAggregates } = require('../lib/stream.js');

const line = (o) => JSON.stringify(o);
const turn = (executionId, kiroExtra = {}) => line({
  type: 'sessionUpdate',
  data: {
    sessionId: 'sess_1',
    update: {
      sessionUpdate: 'session_info_update',
      _meta: { kiro: { promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage: 1 }], elapsedTime: 10, status: 'success', kind: 'turn_completion', executionId, turnId: executionId, ...kiroExtra } },
    },
  },
});
const done = line({ type: 'runFinished', data: { status: 'success' } });
const agg = (...lines) => aggregateStream(parseStream([...lines, done].join('\n')).events);

test('tokens stay null when kiro-cli reports none (the LITE streams)', () => {
  assert.equal(agg(turn('ex1')).tokens, null);
});

test('turn_completion token counts are read, cache kept apart, and a replayed turn counted once', () => {
  const t = { uncachedInputTokens: 1200, outputTokens: 300, cacheReadInputTokens: 50000, cacheWriteInputTokens: 4000 };
  const a = agg(turn('ex1', t), turn('ex1', t), turn('ex2', { tokenUsage: { inputTokens: 100, outputTokens: 10, cachedTokens: 900 } }));
  assert.deepEqual(a.tokens, { input: 1300, output: 310, reasoning: null, cacheRead: 50900, cacheWrite: 4000, total: 56510 });
});

test('the credit number in promptTurnSummaries is never read as tokens', () => {
  assert.equal(agg(turn('ex1', { usage: 3.4 })).tokens, null);
});

test('a v2 metadata event carries input, output and cached tokens', () => {
  const a = agg(line({ type: 'metadata', data: { inputTokens: 7, outputTokens: 3, cachedTokens: 20 } }));
  assert.deepEqual(a.tokens, { input: 7, output: 3, reasoning: null, cacheRead: 20, cacheWrite: null, total: 30 });
});

test('resumed turns sum their tokens; a turn without counts adds nothing', () => {
  const m = mergeAggregates([agg(turn('ex1', { inputTokens: 5, outputTokens: 1 })), agg(turn('ex2')), agg(turn('ex3', { inputTokens: 2, outputTokens: 2 }))]);
  assert.deepEqual(m.tokens, { input: 7, output: 3, reasoning: null, cacheRead: null, cacheWrite: null, total: 10 });
  assert.equal(mergeAggregates([agg(turn('ex1')), agg(turn('ex2'))]).tokens, null);
});

test('a partial kiro-cli token count validates against the result schema', () => {
  const { validate, loadSchema } = require('../lib/schema.js');
  const tokensSchema = loadSchema('result').properties.tokens;
  const a = agg(line({ type: 'metadata', data: { inputTokens: 7, outputTokens: 3 } }));
  assert.deepEqual(validate(tokensSchema, a.tokens), []);
});
